export default {
  init(self) {
    self.apiKey = process.env.APOS_ANTHROPIC_API_KEY;
  },
  apiRoutes(self) {
    return {
      post: {
        async chat(req) {
          self.requireUser(req);
          const { message, messageId } = req.body;
          if (!messageId) {
            throw self.apos.error('invalid', 'messageId is required');
          }
          // Initialize response document in MongoDB
          await self.db().insertOne({
            _id: messageId,
            userId: req.user._id,
            userMessage: message,
            responses: [],
            createdAt: new Date()
          });
          // Simulate async processing with intermediate responses
          self.processMessage(messageId, message);
          return { status: 'processing' };
        }
      },
      get: {
        async poll(req) {
          self.requireUser(req);
          const { messageId, lastIndex } = req.query;
          if (!messageId) {
            throw self.apos.error('invalid', 'messageId is required');
          }
          const startIndex = parseInt(lastIndex, 10) || 0;
          const entry = await self.db().findOne({
            _id: messageId,
            userId: req.user._id
          });
          if (!entry) {
            throw self.apos.error('notfound', 'Unknown messageId');
          }
          // Return responses since lastIndex
          const newResponses = entry.responses.slice(startIndex);
          return { responses: newResponses };
        },
        async history(req) {
          self.requireUser(req);
          const entries = await self.db()
            .find({ userId: req.user._id })
            .sort({ createdAt: 1 })
            .toArray();
          return { entries };
        }
      }
    };
  },
  methods(self) {
    return {
      db() {
        return self.apos.db.collection('aposChatbotMessages');
      },
      requireUser(req) {
        if (!req.user) {
          throw self.apos.error('forbidden', 'Login required');
        }
      },
      async addResponse(messageId, text, final) {
        await self.db().updateOne(
          { _id: messageId },
          { $push: { responses: { text, final } } }
        );
      },
      async processMessage(messageId, message) {
        // Simulate intermediate response after 1 second
        await self.delay(1000);
        await self.addResponse(messageId, `Processing: "${message}"...`, false);
        // Simulate final response after another 1 second
        await self.delay(1000);
        await self.addResponse(messageId, `You said: ${message}`, true);
      },
      delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
      }
    };
  }
}
