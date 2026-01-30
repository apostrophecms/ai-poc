<template>
  <div v-if="visible" class="apos-chatbot">
    <div class="apos-chatbot__messages" ref="messagesContainer">
      <div
        v-for="(message, index) in messages"
        :key="index"
        class="apos-chatbot__message"
        :class="{
          'apos-chatbot__message--user': message.fromUser,
          'apos-chatbot__message--final': message.final
        }"
      >
        <template v-if="message.fromUser">{{ message.text }}</template>
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
            this.messages.push({ text: resp.text, fromUser: false, final: resp.final });
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
    addMessage(text, fromUser = false, final = false) {
      this.messages.push({ text, fromUser, final });
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
      const maxAttempts = 120;
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
          this.addMessage(resp.text, false, resp.final);
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
      return this.pruneForAI(doc);
    },
    // Remove auto-generated search index fields to reduce token usage
    pruneForAI(doc) {
      if (!doc) {
        return doc;
      }
      const pruned = { ...doc };
      delete pruned.lowSearchText;
      delete pruned.highSearchText;
      delete pruned.highSearchWords;
      delete pruned.searchSummary;
      delete pruned.titleSortified;
      return pruned;
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
      return {
        total: data.results.length,
        results: data.results
      };
    },
    async update(_id, docType, updates) {
      const url = `/api/v1/${docType}/${_id}?aposMode=draft`;

      // First GET the current document (draft mode)
      console.log('[chatbot-browser] Fetching document:', url);
      const getResponse = await fetch(url);
      if (!getResponse.ok) {
        throw new Error(`Failed to fetch document: ${getResponse.status}`);
      }
      const currentDoc = await getResponse.json();
      console.log('[chatbot-browser] Current document:', currentDoc);

      // PATCH with updates (draft mode)
      console.log('[chatbot-browser] Patching document:', url, updates);
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
        success: true,
        _id: updatedDoc._id,
        title: updatedDoc.title,
        type: updatedDoc.type
      };
    },
    delay(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
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

.apos-chatbot__markdown :deep(h1),
.apos-chatbot__markdown :deep(h2),
.apos-chatbot__markdown :deep(h3) {
  margin: 0.5em 0 0.25em 0;
  font-size: 1.1em;
}
</style>
