<template>
  <div class="apos-chatbot">
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
        {{ message.text }}
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
export default {
  name: 'AposChatbot',
  data() {
    return {
      messages: [],
      inputText: ''
    };
  },
  async mounted() {
    await this.loadHistory();
  },
  methods: {
    async loadHistory() {
      try {
        const response = await fetch('/api/v1/chatbot/history');
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
          body: JSON.stringify({ message: text, messageId })
        });
        // Poll for responses
        await this.pollForResponses(messageId);
      } catch (error) {
        this.addMessage('Error: Could not get response', false);
      }
    },
    async pollForResponses(messageId) {
      const pollInterval = 500;
      const maxAttempts = 60;
      let attempts = 0;
      let lastIndex = 0;
      while (attempts < maxAttempts) {
        attempts++;
        const response = await fetch(`/api/v1/chatbot/poll?messageId=${encodeURIComponent(messageId)}&lastIndex=${lastIndex}`);
        if (!response.ok) {
          throw new Error('Poll request failed');
        }
        const data = await response.json();
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
    delay(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
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
  width: 300px;
  height: 400px;
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
</style>
