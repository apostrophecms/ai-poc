<template>
  <div class="apos-chatbot">
    <div class="apos-chatbot__messages" ref="messagesContainer">
      <div
        v-for="(message, index) in messages"
        :key="index"
        class="apos-chatbot__message"
        :class="{ 'apos-chatbot__message--user': message.fromUser }"
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
    console.log('component alive');
    return {
      messages: [
        { text: 'Chat with me', fromUser: false }
      ],
      inputText: ''
    };
  },
  methods: {
    addMessage(text, fromUser = false) {
      this.messages.push({ text, fromUser });
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
      while (attempts < maxAttempts) {
        attempts++;
        const response = await fetch(`/api/v1/chatbot/poll?messageId=${encodeURIComponent(messageId)}`);
        if (!response.ok) {
          throw new Error('Poll request failed');
        }
        const data = await response.json();
        let receivedFinal = false;
        for (const resp of data.responses) {
          this.addMessage(resp.text, false);
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
