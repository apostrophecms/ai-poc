export default {
  init(self) {
    self.apiKey = process.env.APOS_ANTHROPIC_API_KEY;
  },
  handlers(self) {
    return {
      'apostrophe:ready': {
        buildTools() {
          // Build content type info from doc managers
          self.contentTypes = self.getContentTypes();
          console.log('[chatbot] Content types found:', self.contentTypes.map(t => t.name));
          const typeList = self.contentTypes
            .map(t => `- ${t.name}: ${t.label}${t.isPage ? ' (page)' : ''}`)
            .join('\n');

          self.tools = [
            {
              name: 'search',
              description: `Search for content in the CMS using keyword-based search (not semantic/vector search, so exact word matches matter).

Available content types:
${typeList}

IMPORTANT:
- You MUST specify a content type. There is no global search.
- If unsure which type, try likely ones based on context (e.g., "article" for news/blog content, pages for general content).
- If a search returns no results, try synonyms or alternative phrasings (e.g., "cats" → "cat", "feline", "kitten").
- Try the user's exact words first, then fall back to alternatives.
- You can call search multiple times with different types or keywords.`,
              input_schema: {
                type: 'object',
                properties: {
                  query: {
                    type: 'string',
                    description: 'The search query - use specific keywords. Try the user\'s exact words first.'
                  },
                  type: {
                    type: 'string',
                    description: 'The content type to search (e.g., "article", "@apostrophecms/image", "default-page"). Required.'
                  }
                },
                required: ['query', 'type']
              }
            }
          ];
          console.log('[chatbot] Tools configured:', JSON.stringify(self.tools, null, 2));
        }
      }
    };
  },
  apiRoutes(self) {
    return {
      post: {
        async chat(req) {
          self.requireUser(req);
          const { message, messageId, chatId } = req.body;
          console.log('[chatbot] Chat request received:', { messageId, chatId, message });
          if (!messageId || !chatId) {
            throw self.apos.error('invalid', 'messageId and chatId are required');
          }
          // Create document for this message exchange
          await self.db().insertOne({
            messageId,
            chatId,
            userId: req.user._id,
            userMessage: message,
            responses: [],
            pendingAction: null,
            actionResult: null,
            createdAt: new Date()
          });
          // Process asynchronously
          self.processMessage(messageId, chatId, message, req.user._id);
          return { status: 'processing' };
        },
        async actionResult(req) {
          self.requireUser(req);
          const { messageId, result } = req.body;
          console.log('[chatbot] actionResult received:', { messageId, result: JSON.stringify(result, null, 2) });
          if (!messageId) {
            throw self.apos.error('invalid', 'messageId is required');
          }
          await self.db().updateOne(
            { messageId, userId: req.user._id },
            {
              $set: {
                actionResult: result,
                pendingAction: null
              }
            }
          );
          console.log('[chatbot] actionResult stored in DB');
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
            messageId,
            userId: req.user._id
          });
          if (!entry) {
            throw self.apos.error('notfound', 'Unknown messageId');
          }
          // Return responses since lastIndex, plus any pending action
          const newResponses = entry.responses.slice(startIndex);
          if (entry.pendingAction) {
            console.log('[chatbot] poll returning pendingAction:', entry.pendingAction);
          }
          if (newResponses.length > 0) {
            console.log('[chatbot] poll returning responses:', newResponses.length);
          }
          return {
            responses: newResponses,
            pendingAction: entry.pendingAction
          };
        },
        async history(req) {
          self.requireUser(req);
          const { chatId } = req.query;
          if (!chatId) {
            throw self.apos.error('invalid', 'chatId is required');
          }
          const entries = await self.db()
            .find({ userId: req.user._id, chatId })
            .sort({ createdAt: 1 })
            .toArray();
          return { entries };
        }
      }
    };
  },
  methods(self) {
    return {
      getContentTypes() {
        const types = [];
        for (const [name, manager] of Object.entries(self.apos.doc.managers)) {
          const isPage = self.apos.instanceOf(manager, '@apostrophecms/page-type');
          const isPiece = self.apos.instanceOf(manager, '@apostrophecms/piece-type');
          if (!isPage && !isPiece) {
            continue;
          }
          types.push({
            name,
            label: manager.options.label || name,
            isPage
          });
        }
        return types;
      },
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
          { messageId },
          { $push: { responses: { text, final } } }
        );
      },
      async buildConversationHistory(chatId, currentMessageId) {
        // Get previous messages in this chat, excluding the current one
        const entries = await self.db()
          .find({
            chatId,
            messageId: { $ne: currentMessageId }
          })
          .sort({ createdAt: 1 })
          .toArray();

        const messages = [];
        for (const entry of entries) {
          // Only include complete exchanges (user message + final assistant response)
          const finalResponse = entry.responses.find(r => r.final);
          if (!finalResponse) {
            // Skip incomplete exchanges to avoid corrupting message sequence
            continue;
          }
          messages.push({ role: 'user', content: entry.userMessage });
          messages.push({ role: 'assistant', content: finalResponse.text });
        }

        return messages;
      },
      async processMessage(messageId, chatId, message, userId) {
        console.log('[chatbot] processMessage started:', { messageId, chatId, message });
        try {
          const messages = await self.buildConversationHistory(chatId, messageId);
          console.log('[chatbot] Conversation history built, message count:', messages.length);
          messages.push({ role: 'user', content: message });

          console.log('[chatbot] Calling Claude with messages:', JSON.stringify(messages, null, 2));
          let response = await self.callClaude(messages);
          console.log('[chatbot] Claude response:', JSON.stringify(response, null, 2));

          // Handle tool use loop
          while (response.stop_reason === 'tool_use') {
            console.log('[chatbot] Tool use detected');
            const toolUseBlock = response.content.find(block => block.type === 'tool_use');
            if (!toolUseBlock) {
              console.log('[chatbot] No tool_use block found, breaking');
              break;
            }

            console.log('[chatbot] Executing tool:', toolUseBlock.name, 'with input:', toolUseBlock.input);
            const toolResult = await self.executeTool(messageId, toolUseBlock);
            console.log('[chatbot] Tool result:', JSON.stringify(toolResult, null, 2));

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

            console.log('[chatbot] Calling Claude again with tool result');
            response = await self.callClaude(messages);
            console.log('[chatbot] Claude response after tool:', JSON.stringify(response, null, 2));
          }

          // Extract final text response
          const textBlock = response.content.find(block => block.type === 'text');
          const finalText = textBlock ? textBlock.text : 'No response generated.';
          console.log('[chatbot] Final text response:', finalText);
          await self.addResponse(messageId, finalText, true);
        } catch (error) {
          console.error('[chatbot] Error processing message:', error);
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

        if (name === 'search') {
          return self.executeSearch(messageId, input.query, input.type);
        }

        return { error: `Unknown tool: ${name}` };
      },
      async executeSearch(messageId, query, contentType) {
        console.log('[chatbot] executeSearch:', { messageId, query, contentType });
        // Determine if this is a page type
        let isPage = false;
        if (contentType) {
          const typeInfo = self.contentTypes.find(t => t.name === contentType);
          if (typeInfo) {
            isPage = typeInfo.isPage;
          }
        }
        console.log('[chatbot] Setting pending action for browser:', { query, contentType, isPage });

        // Set pending action for browser to execute
        await self.db().updateOne(
          { messageId },
          {
            $set: {
              pendingAction: {
                type: 'search',
                query,
                contentType, // null for global search, or specific type name
                isPage
              },
              actionResult: null
            }
          }
        );

        // Wait for browser to execute and return result
        console.log('[chatbot] Waiting for browser action result...');
        const result = await self.waitForActionResult(messageId);
        console.log('[chatbot] Browser action result received:', JSON.stringify(result, null, 2));
        return result;
      },
      async waitForActionResult(messageId, timeoutMs = 30000) {
        const startTime = Date.now();
        const pollInterval = 200;

        while (Date.now() - startTime < timeoutMs) {
          const entry = await self.db().findOne({ messageId });
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
