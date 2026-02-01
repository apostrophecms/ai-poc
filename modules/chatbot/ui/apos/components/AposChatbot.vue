<template>
  <div v-if="visible" class="apos-chatbot">
    <div class="apos-chatbot__messages" ref="messagesContainer">
      <div
        v-for="(message, index) in messages"
        :key="index"
        class="apos-chatbot__message"
        :class="{
          'apos-chatbot__message--user': message.fromUser,
          'apos-chatbot__message--final': message.final,
          'apos-chatbot__message--accordion': message.accordion
        }"
      >
        <template v-if="message.fromUser">{{ message.text }}</template>
        <details v-else-if="message.accordion" class="apos-chatbot__accordion">
          <summary class="apos-chatbot__accordion-summary">{{ message.accordionSummary }}</summary>
          <pre class="apos-chatbot__accordion-content">{{ message.text }}</pre>
        </details>
        <div v-else v-html="renderMarkdown(message.text)" class="apos-chatbot__markdown"></div>
      </div>
    </div>
    <div class="apos-chatbot__input-container">
      <textarea
        v-model="inputText"
        class="apos-chatbot__input"
        placeholder="Type a message..."
        @keydown.enter.prevent="sendMessage"
      />
    </div>
  </div>
</template>

<script>
import { marked } from 'marked';

export default {
  name: 'AposChatbot',
  data() {
    return {
      visible: false,
      messages: [],
      inputText: '',
      chatId: null
    };
  },
  async mounted() {
    this.chatId = this.generateId();
    apos.bus.$on('admin-menu-click', this.onAdminMenuClick);
  },
  beforeUnmount() {
    apos.bus.$off('admin-menu-click', this.onAdminMenuClick);
  },
  methods: {
    onAdminMenuClick(name) {
      if (name === 'chatbot:toggle') {
        this.visible = !this.visible;
        if (this.visible && this.messages.length === 0) {
          this.loadHistory();
        }
      }
    },
    async loadHistory() {
      try {
        const response = await fetch(`/api/v1/chatbot/history?chatId=${encodeURIComponent(this.chatId)}`);
        if (!response.ok) {
          if (response.status === 403) {
            this.messages.push({ text: 'Please log in to chat.', fromUser: false, final: true });
            return;
          }
          throw new Error('Failed to load history');
        }
        const data = await response.json();
        for (const entry of data.entries) {
          this.messages.push({ text: entry.userMessage, fromUser: true });
          for (const resp of entry.responses) {
            const message = { text: resp.text, fromUser: false, final: resp.final };
            if (resp.accordion) {
              message.accordion = true;
              message.accordionSummary = resp.accordionSummary || 'Details';
            }
            this.messages.push(message);
          }
        }
        if (this.messages.length === 0) {
          this.messages.push({ text: 'Chat with me', fromUser: false, final: true });
        }
        this.scrollToBottom();
      } catch (error) {
        this.messages.push({ text: 'Error loading chat history', fromUser: false, final: true });
      }
    },
    addMessage(text, fromUser = false, final = false, options = {}) {
      const message = { text, fromUser, final };
      if (options.accordion) {
        message.accordion = true;
        message.accordionSummary = options.accordionSummary || 'Details';
      }
      this.messages.push(message);
      this.scrollToBottom();
    },
    scrollToBottom() {
      this.$nextTick(() => {
        const container = this.$refs.messagesContainer;
        if (container) {
          container.scrollTop = container.scrollHeight;
        }
      });
    },
    generateId() {
      return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    },
    async sendMessage() {
      const text = this.inputText.trim();
      if (!text) {
        return;
      }
      this.addMessage(text, true);
      this.inputText = '';
      const messageId = this.generateId();
      try {
        // Start processing
        await fetch('/api/v1/chatbot/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ message: text, messageId, chatId: this.chatId })
        });
        // Poll for responses
        await this.pollForResponses(messageId);
      } catch (error) {
        this.addMessage('Error: Could not get response', false);
      }
    },
    async pollForResponses(messageId) {
      const pollInterval = 500;
      const maxAttempts = 1000;
      let attempts = 0;
      let lastIndex = 0;
      while (attempts < maxAttempts) {
        attempts++;
        const response = await fetch(`/api/v1/chatbot/poll?messageId=${encodeURIComponent(messageId)}&lastIndex=${lastIndex}`);
        if (!response.ok) {
          throw new Error('Poll request failed');
        }
        const data = await response.json();

        // Handle pending action from server
        if (data.pendingAction) {
          console.log('[chatbot-browser] Received pending action:', data.pendingAction);
          await this.executeAction(messageId, data.pendingAction);
        }

        let receivedFinal = false;
        for (const resp of data.responses) {
          this.addMessage(resp.text, false, resp.final, {
            accordion: resp.accordion,
            accordionSummary: resp.accordionSummary
          });
          lastIndex++;
          if (resp.final) {
            receivedFinal = true;
          }
        }
        if (receivedFinal) {
          return;
        }
        await this.delay(pollInterval);
      }
      this.addMessage('Error: Response timed out', false);
    },
    async executeAction(messageId, action) {
      console.log('[chatbot-browser] Executing action:', action.type);
      let result;
      try {
        if (action.type === 'search') {
          result = await this.search(action.query);
        } else if (action.type === 'update') {
          result = await this.update(action._id, action.docType, action.updates);
        } else if (action.type === 'get-context') {
          result = await this.getContext();
        } else if (action.type === 'add-widget') {
          result = await this.addWidget(action.docId, action.docType, action.areaId, action.widget, action.position);
        } else if (action.type === 'delete-widget') {
          result = await this.deleteWidget(action.docId, action.docType, action.widgetId);
        } else {
          result = { error: `Unknown action type: ${action.type}` };
        }
      } catch (error) {
        console.error('[chatbot-browser] Action error:', error);
        result = { error: error.message };
      }

      console.log('[chatbot-browser] Sending result back to server:', result);
      // Send result back to server
      console.log(`${messageId} ${action.type} ${action.query} result length is:`, JSON.stringify(result).length);

      await fetch('/api/v1/chatbot/action-result', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId, result })
      });
    },
    async getContext() {
      // Get the current context document
      const context = apos.adminBar.context;
      if (!context || !context._id || !context.type) {
        return { error: 'No context document available - the user is not viewing a specific page or piece.' };
      }

      // Use the module's action URL to fetch the full document
      const module = apos.modules[context.type];
      if (!module || !module.action) {
        return { error: `Cannot find REST API for type: ${context.type}` };
      }

      const url = `${module.action}/${context._id}?aposMode=draft`;
      console.log('[chatbot-browser] Fetching context document:', url);

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch context document: ${response.status}`);
      }

      const doc = await response.json();
      console.log('[chatbot-browser] Context document:', doc);
      // Return only core properties to save tokens
      return this.toCoreProperties(doc);
    },
    // Extract only core properties to minimize token usage
    toCoreProperties(doc) {
      if (!doc) {
        return doc;
      }
      return {
        _id: doc._id,
        aposDocId: doc.aposDocId,
        type: doc.type,
        title: doc.title,
        slug: doc.slug
      };
    },
    async search(query) {
      // Use polymorphic search API that searches all content types (draft mode)
      const url = `/api/v1/chatbot/search?aposMode=draft&q=${encodeURIComponent(query)}`;

      console.log('[chatbot-browser] Fetching:', url);
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Search failed: ${response.status}`);
      }
      const data = await response.json();
      console.log('[chatbot-browser] Search results:', data);
      // Return only core properties to save tokens
      return {
        total: data.results.length,
        results: data.results.map(doc => this.toCoreProperties(doc))
      };
    },
    async addWidget(docId, docType, areaId, widget, position) {
      const baseUrl = apos.modules[docType]?.action;
      if (!baseUrl) {
        throw new Error(`Cannot find REST API for type: ${docType}`);
      }
      const url = `${baseUrl}/${docId}?aposMode=draft`;

      // First GET the current document
      console.log('[chatbot-browser] Fetching document for add-widget:', url);
      const getResponse = await fetch(url);
      if (!getResponse.ok) {
        throw new Error(`Failed to fetch document: ${getResponse.status}`);
      }
      const currentDoc = await getResponse.json();

      // Find the area by _id using recursive descent
      const area = this.findAreaById(currentDoc, areaId);
      if (!area) {
        throw new Error(`Area not found: ${areaId}`);
      }

      // Insert the widget at the specified position
      const items = area.items || [];
      if (position === 'end' || position >= items.length) {
        items.push(widget);
      } else {
        items.splice(position, 0, widget);
      }
      area.items = items;

      // PATCH with the entire document (area was modified in place)
      // Use @ reference to target the area by its _id
      const patch = {
        [`@${areaId}`]: area
      };

      this.addPatchDebugMessage(url, patch);
      const patchResponse = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
      });
      if (!patchResponse.ok) {
        const errorText = await patchResponse.text();
        throw new Error(`Failed to add widget: ${patchResponse.status} ${errorText}`);
      }
      const updatedDoc = await patchResponse.json();
      console.log('[chatbot-browser] Widget added successfully');

      // Emit event so Apostrophe UI reflects the change
      apos.bus.$emit('content-changed', {
        doc: updatedDoc,
        action: 'update'
      });

      return {
        success: true,
        widgetId: widget._id
      };
    },
    async deleteWidget(docId, docType, widgetId) {
      const baseUrl = apos.modules[docType]?.action;
      if (!baseUrl) {
        throw new Error(`Cannot find REST API for type: ${docType}`);
      }
      const url = `${baseUrl}/${docId}?aposMode=draft`;

      // First GET the current document
      console.log('[chatbot-browser] Fetching document for delete-widget:', url);
      const getResponse = await fetch(url);
      if (!getResponse.ok) {
        throw new Error(`Failed to fetch document: ${getResponse.status}`);
      }
      const currentDoc = await getResponse.json();

      // Find the area containing the widget and remove it
      const result = this.findAndRemoveWidget(currentDoc, widgetId);
      if (!result) {
        throw new Error(`Widget not found: ${widgetId}`);
      }

      // PATCH with @ reference to update the area
      const patch = {
        [`@${result.areaId}`]: result.area
      };

      this.addPatchDebugMessage(url, patch);
      const patchResponse = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
      });
      if (!patchResponse.ok) {
        const errorText = await patchResponse.text();
        throw new Error(`Failed to delete widget: ${patchResponse.status} ${errorText}`);
      }
      const updatedDoc = await patchResponse.json();
      console.log('[chatbot-browser] Widget deleted successfully');

      // Emit event so Apostrophe UI reflects the change
      apos.bus.$emit('content-changed', {
        doc: updatedDoc,
        action: 'update'
      });

      return {
        success: true,
        deletedWidgetId: widgetId
      };
    },
    // Find a widget by _id and remove it from its parent area
    findAndRemoveWidget(obj, widgetId, parentArea = null, parentAreaId = null) {
      if (!obj || typeof obj !== 'object') {
        return null;
      }

      // Check if this is an area
      if (obj.metaType === 'area' && Array.isArray(obj.items)) {
        const index = obj.items.findIndex(item => item._id === widgetId);
        if (index !== -1) {
          // Found it - remove and return the area info
          obj.items.splice(index, 1);
          return { area: obj, areaId: obj._id };
        }
        // Recurse into widgets in this area
        for (const item of obj.items) {
          const result = this.findAndRemoveWidget(item, widgetId, obj, obj._id);
          if (result) {
            return result;
          }
        }
      }

      // Recurse into all properties
      for (const key of Object.keys(obj)) {
        const value = obj[key];
        if (value && typeof value === 'object') {
          const result = this.findAndRemoveWidget(value, widgetId, parentArea, parentAreaId);
          if (result) {
            return result;
          }
        }
      }

      return null;
    },
    // Recursively find an area by its _id
    findAreaById(obj, areaId) {
      if (!obj || typeof obj !== 'object') {
        return null;
      }
      // Check if this object is the area we're looking for
      if (obj._id === areaId && obj.metaType === 'area') {
        return obj;
      }
      // Recurse into all properties
      for (const key of Object.keys(obj)) {
        const value = obj[key];
        if (Array.isArray(value)) {
          for (const item of value) {
            const found = this.findAreaById(item, areaId);
            if (found) {
              return found;
            }
          }
        } else if (value && typeof value === 'object') {
          const found = this.findAreaById(value, areaId);
          if (found) {
            return found;
          }
        }
      }
      return null;
    },
    async update(_id, docType, updates) {
      const baseUrl = apos.modules[docType]?.action;
      if (!baseUrl) {
        throw new Error(`Cannot find REST API for type: ${docType}`);
      }
      const url = `${baseUrl}/${_id}?aposMode=draft`;

      // First GET the current document (draft mode)
      console.log('[chatbot-browser] Fetching document:', url);
      const getResponse = await fetch(url);
      if (!getResponse.ok) {
        throw new Error(`Failed to fetch document: ${getResponse.status}`);
      }
      const currentDoc = await getResponse.json();
      console.log('[chatbot-browser] Current document:', currentDoc);

      // PATCH with updates (draft mode)
      this.addPatchDebugMessage(url, updates);
      const patchResponse = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
      if (!patchResponse.ok) {
        const errorText = await patchResponse.text();
        throw new Error(`Failed to update document: ${patchResponse.status} ${errorText}`);
      }
      const updatedDoc = await patchResponse.json();
      console.log('[chatbot-browser] Updated document:', updatedDoc);

      // Emit event so Apostrophe UI reflects the change
      apos.bus.$emit('content-changed', {
        doc: updatedDoc,
        action: 'update'
      });

      return {
        success: true
      };
    },
    delay(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    },
    addPatchDebugMessage(url, body) {
      const bodyJson = JSON.stringify(body, null, 2);
      const charCount = bodyJson.length;
      // Extract first ~100 chars for preview
      let preview = bodyJson.substring(0, 100).replace(/\n/g, ' ');
      if (bodyJson.length > 100) {
        preview += '...';
      }
      const summary = `PATCH ${url.split('?')[0]} (${charCount.toLocaleString()} chars) — ${preview}`;
      this.addMessage(bodyJson, false, false, {
        accordion: true,
        accordionSummary: summary
      });
    },
    renderMarkdown(text) {
      return marked(text || '');
    }
  }
};
</script>

<style scoped>
.apos-chatbot {
  position: fixed;
  display: flex;
  flex-direction: column;
  bottom: 20px;
  right: 20px;
  border: 2px solid gray;
  width: 450px;
  height: 600px;
  background-color: white;
  border-radius: 8px;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  z-index: 9999;
}

.apos-chatbot__messages {
  flex: 1;
  overflow-y: auto;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.apos-chatbot__message {
  padding: 8px 12px;
  border-radius: 8px;
  max-width: 80%;
  word-wrap: break-word;
  align-self: flex-start;
  background-color: #f1f1f1;
  user-select: text;
  -webkit-user-select: text;
  color: black;
}

.apos-chatbot__message--user {
  align-self: flex-end;
  background-color: #007bff;
  color: white;
}

.apos-chatbot__message--final {
  border-left: 3px solid #28a745;
}

.apos-chatbot__input-container {
  border-top: 1px solid #ccc;
  padding: 10px;
}

.apos-chatbot__input {
  width: 100%;
  height: 60px;
  resize: none;
  border: 1px solid #ddd;
  border-radius: 4px;
  padding: 8px;
  font-family: sans-serif;
  box-sizing: border-box;
}

.apos-chatbot__markdown {
  line-height: 1.5;
}

.apos-chatbot__markdown :deep(p) {
  margin: 0 0 0.5em 0;
}

.apos-chatbot__markdown :deep(p:last-child) {
  margin-bottom: 0;
}

.apos-chatbot__markdown :deep(ul),
.apos-chatbot__markdown :deep(ol) {
  margin: 0.5em 0;
  padding-left: 1.5em;
}

.apos-chatbot__markdown :deep(code) {
  background-color: rgba(0, 0, 0, 0.1);
  padding: 0.1em 0.3em;
  border-radius: 3px;
  font-size: 0.9em;
}

.apos-chatbot__markdown :deep(pre) {
  background-color: rgba(0, 0, 0, 0.1);
  padding: 0.5em;
  border-radius: 4px;
  overflow-x: auto;
  margin: 0.5em 0;
}

.apos-chatbot__markdown :deep(pre code) {
  background: none;
  padding: 0;
}

.apos-chatbot__markdown :deep(a) {
  color: #0066cc;
}

.apos-chatbot__message--accordion {
  max-width: 100%;
  background-color: #e8e8e8;
  font-size: 0.85em;
}

.apos-chatbot__accordion {
  width: 100%;
}

.apos-chatbot__accordion-summary {
  cursor: pointer;
  font-family: monospace;
  font-size: 0.9em;
  color: #555;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  padding: 4px 0;
}

.apos-chatbot__accordion-summary:hover {
  color: #000;
}

.apos-chatbot__accordion-content {
  margin-top: 8px;
  padding: 8px;
  background-color: #f8f8f8;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 0.85em;
  max-height: 300px;
  overflow: auto;
  white-space: pre-wrap;
  word-wrap: break-word;
}

.apos-chatbot__markdown :deep(h1),
.apos-chatbot__markdown :deep(h2),
.apos-chatbot__markdown :deep(h3) {
  margin: 0.5em 0 0.25em 0;
  font-size: 1.1em;
}
</style>
