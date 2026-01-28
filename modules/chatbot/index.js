export default {
  init(self) {
    self.apiKey = process.env.APOS_ANTHROPIC_API_KEY;
    self.tools = [
      {
        name: 'search_articles',
        description: 'Search for articles in the CMS. Use this when the user wants to find articles about a topic.',
        input_schema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'The search query to find articles'
            }
          },
          required: ['query']
        }
      }
    ];
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
            pendingAction: null,
            actionResult: null,
            createdAt: new Date()
          });
          // Process asynchronously
          self.processMessage(messageId, message, req.user._id);
          return { status: 'processing' };
        },
        async actionResult(req) {
          self.requireUser(req);
          const { messageId, result } = req.body;
          if (!messageId) {
            throw self.apos.error('invalid', 'messageId is required');
          }
          await self.db().updateOne(
            { _id: messageId, userId: req.user._id },
            {
              $set: {
                actionResult: result,
                pendingAction: null
              }
            }
          );
          return { status: 'ok' };
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
          // Return responses since lastIndex, plus any pending action
          const newResponses = entry.responses.slice(startIndex);
          return {
            responses: newResponses,
            pendingAction: entry.pendingAction
          };
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
      async processMessage(messageId, message, userId) {
        try {
          const messages = await self.buildConversationHistory(userId, messageId);
          messages.push({ role: 'user', content: message });
          let response = await self.callClaude(messages);

          // Handle tool use loop
          while (response.stop_reason === 'tool_use') {
            const toolUseBlock = response.content.find(block => block.type === 'tool_use');
            if (!toolUseBlock) {
              break;
            }

            const toolResult = await self.executeTool(messageId, toolUseBlock);

            // Continue conversation with tool result
            messages.push({ role: 'assistant', content: response.content });
            messages.push({
              role: 'user',
              content: [{
                type: 'tool_result',
                tool_use_id: toolUseBlock.id,
                content: JSON.stringify(toolResult)
              }]
            });

            response = await self.callClaude(messages);
          }

          // Extract final text response
          const textBlock = response.content.find(block => block.type === 'text');
          const finalText = textBlock ? textBlock.text : 'No response generated.';
          await self.addResponse(messageId, finalText, true);
        } catch (error) {
          console.error('Error processing message:', error);
          await self.addResponse(messageId, `Error: ${error.message}`, true);
        }
      },
      async callClaude(messages) {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': self.apiKey,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 1024,
            tools: self.tools,
            messages
          })
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Claude API error: ${response.status} ${errorText}`);
        }

        return response.json();
      },
      async executeTool(messageId, toolUseBlock) {
        const { name, input } = toolUseBlock;

        if (name === 'search_articles') {
          return self.executeSearchArticles(messageId, input.query);
        }

        return { error: `Unknown tool: ${name}` };
      },
      async executeSearchArticles(messageId, query) {
        // Set pending action for browser to execute
        await self.db().updateOne(
          { _id: messageId },
          {
            $set: {
              pendingAction: {
                type: 'search_articles',
                query
              },
              actionResult: null
            }
          }
        );

        // Wait for browser to execute and return result
        const result = await self.waitForActionResult(messageId);
        return result;
      },
      async waitForActionResult(messageId, timeoutMs = 30000) {
        const startTime = Date.now();
        const pollInterval = 200;

        while (Date.now() - startTime < timeoutMs) {
          const entry = await self.db().findOne({ _id: messageId });
          if (entry && entry.actionResult !== null) {
            return entry.actionResult;
          }
          await self.delay(pollInterval);
        }

        throw new Error('Timeout waiting for browser action result');
      },
      delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
      }
    };
  }
}
