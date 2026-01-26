export default {
  init(self) {
    self.apiKey = process.env.APOS_ANTHROPIC_API_KEY;
    // In-memory store for responses keyed by messageId
    // Each entry: { responses: [...], nextIndex: 0 }
    self.pending = {};
  },
  apiRoutes(self) {
    return {
      post: {
        async chat(req) {
          const { message, messageId } = req.body;
          if (!messageId) {
            throw self.apos.error('invalid', 'messageId is required');
          }
          // Initialize response queue for this message
          self.pending[messageId] = {
            responses: [],
            nextIndex: 0
          };
          // Simulate async processing with intermediate responses
          self.processMessage(messageId, message);
          return { status: 'processing' };
        }
      },
      get: {
        async poll(req) {
          const { messageId } = req.query;
          if (!messageId) {
            throw self.apos.error('invalid', 'messageId is required');
          }
          const entry = self.pending[messageId];
          if (!entry) {
            throw self.apos.error('notfound', 'Unknown messageId');
          }
          // Return any new responses since last poll
          const newResponses = entry.responses.slice(entry.nextIndex);
          entry.nextIndex = entry.responses.length;
          // Clean up if we've delivered the final response
          const hasFinal = newResponses.some(r => r.final);
          if (hasFinal) {
            delete self.pending[messageId];
          }
          return { responses: newResponses };
        }
      }
    };
  },
  methods(self) {
    return {
      async processMessage(messageId, message) {
        const entry = self.pending[messageId];
        if (!entry) {
          return;
        }
        // Simulate intermediate response after 1 second
        await self.delay(1000);
        if (self.pending[messageId]) {
          entry.responses.push({
            text: `Processing: "${message}"...`,
            final: false
          });
        }
        // Simulate final response after another 1 second
        await self.delay(1000);
        if (self.pending[messageId]) {
          entry.responses.push({
            text: `You said: ${message}`,
            final: true
          });
        }
      },
      delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
      }
    };
  }
}
