export default {
  icons: {
    'robot-icon': 'Robot'
  },
  init(self) {
    self.apiKey = process.env.APOS_ANTHROPIC_API_KEY;
    self.apos.adminBar.add(
      'chatbot:toggle',
      'AI',
      null,
      {
        contextUtility: true,
        toggle: true,
        icon: 'robot-icon',
        tooltip: {
          activate: 'Open AI Chat',
          deactivate: 'Close AI Chat'
        }
      }
    );
  },
  handlers(self) {
    return {
      'apostrophe:ready': {
        buildTools() {
          self.tools = [
            {
              name: 'search',
              description: `Search for content across the entire CMS using keyword-based search (not semantic/vector search, so exact word matches matter).

This searches all content types (articles, pages, images, etc.) and returns results ordered by relevance.

IMPORTANT:
- If a search returns no results, try synonyms or alternative phrasings (e.g., "cats" → "cat", "feline", "kitten").
- Try the user's exact words first, then fall back to alternatives.`,
              input_schema: {
                type: 'object',
                properties: {
                  query: {
                    type: 'string',
                    description: 'The search query - use specific keywords. Try the user\'s exact words first.'
                  }
                },
                required: ['query']
              }
            },
            {
              name: 'update',
              description: `Update a document in the CMS by its _id.

Use this to modify content like articles, pages, or other editable documents.

IMPORTANT:
- You must have the document's _id from a previous search result.
- Only update fields that the user explicitly asked to change.
- For rich text or area fields, you may need to understand their structure.
- You CANNOT update users or permission groups - those requests will be rejected.`,
              input_schema: {
                type: 'object',
                properties: {
                  _id: {
                    type: 'string',
                    description: 'The _id of the document to update (from search results)'
                  },
                  updates: {
                    type: 'object',
                    description: 'An object containing the fields to update and their new values'
                  }
                },
                required: ['_id', 'updates']
              }
            },
            {
              name: 'doc-schema',
              description: `Get the schema for a document type (pieces and pages).

Use this to understand what fields exist on document types like articles, pages, images, etc.

Call with no parameters to list all available doc types.
Call with a specific type name to get its full schema.

IMPORTANT:
- Area fields have an 'options.widgets' property showing which widgets they accept
- Use widget-schema to understand how to construct widget content for areas`,
              input_schema: {
                type: 'object',
                properties: {
                  typeName: {
                    type: 'string',
                    description: 'The doc type (e.g., "article", "default-page", "@apostrophecms/home-page") to get the schema for. Omit to list all available doc types.'
                  }
                },
                required: []
              }
            },
            {
              name: 'widget-schema',
              description: `Get the schema for a widget type.

Use this to understand how to construct widget content for area fields.

Call with no parameters to list all available widget types.
Call with a specific widget type name to get its full schema.

IMPORTANT:
- Widgets go inside area fields on documents
- Each widget needs a proper structure with _id, metaType: 'widget', and type
- Layout widgets have nested areas in their columns`,
              input_schema: {
                type: 'object',
                properties: {
                  typeName: {
                    type: 'string',
                    description: 'The widget type (e.g., "@apostrophecms/rich-text", "@apostrophecms/image", "@apostrophecms/layout") to get the schema for. Omit to list all available widget types.'
                  }
                },
                required: []
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
        // Polymorphic search API - searches all types, returns properly
        // hydrated documents with relationships and URLs
        async search(req) {
          self.requireUser(req);
          const q = self.apos.launder.string(req.query.q);
          const limit = self.apos.launder.integer(req.query.limit, 10, 1, 100);

          if (!q) {
            return { results: [] };
          }

          // Initial query across all searchable types
          const query = self.apos.doc
            .find(req)
            .search(q)
            .limit(limit);

          // Polymorphic find: fetch just the ids at first, then go back
          // and fetch them via their own type managers so that we get the
          // expected relationships and urls and suchlike.
          const idsAndTypes = await query.project({
            _id: 1,
            type: 1
          }).toArray();

          const byType = {};
          for (const doc of idsAndTypes) {
            if (!byType[doc.type]) {
              byType[doc.type] = [];
            }
            byType[doc.type].push(doc._id);
          }

          let docs = [];

          for (const type in byType) {
            const manager = self.apos.doc.getManager(type);
            if (!manager) {
              continue;
            }
            const typeDocs = await manager.find(req, {
              _id: { $in: byType[type] }
            }).toArray();
            docs = docs.concat(typeDocs);
          }

          // Restore the intended order ($in doesn't respect it and neither does
          // fetching them all by type)
          const orderedDocs = self.apos.util.orderById(
            idsAndTypes.map(d => d._id),
            docs
          );

          return {
            results: orderedDocs
          };
        },
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
        const systemPrompt = `You are a helpful CMS assistant with access to tools for searching and updating content.

CRITICAL INSTRUCTIONS:
- When the user asks you to make a change, you MUST actually call the update tool. Do not just describe what you would do.
- Never say "I will update..." or "Let me update..." without immediately following through with the tool call.
- If you need information first, use the search or schema tools to get it.
- After making changes, confirm what was actually done based on the tool result.
- If a tool call fails, report the actual error to the user.

MAKING UPDATES:
- Make MINIMAL, surgical updates. Only include the specific fields you're changing.
- For simple field changes (title, slug, etc.), just update that one field.
- NEVER send back an entire document - only the fields that need to change.
- Keep your update payloads as small as possible to avoid truncation.

UPDATING WIDGETS (IMPORTANT):
- To update a specific widget, use an "@ reference" with the widget's _id.
- Format: { "@widgetIdHere": { ...fields to update... } }
- Example: To update a rich-text widget's content, use: { "@abc123": { "content": "<p>New text</p>" } }
- This lets you surgically update one widget without touching the rest of the area.
- NEVER replace an entire area array - always use @ references to update specific widgets.

You have full permission to search, read schemas, and update content. Use your tools.`;

        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': self.apiKey,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-5-20250929',
            max_tokens: 8192,
            system: systemPrompt,
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
          return self.executeSearch(messageId, input.query);
        }

        if (name === 'update') {
          return self.executeUpdate(messageId, input._id, input.updates);
        }

        if (name === 'doc-schema') {
          return self.executeDocSchema(input.typeName);
        }

        if (name === 'widget-schema') {
          return self.executeWidgetSchema(input.typeName);
        }

        return { error: `Unknown tool: ${name}` };
      },
      async executeSearch(messageId, query) {
        console.log('[chatbot] executeSearch:', { messageId, query });

        // Set pending action for browser to execute via polymorphic search API
        await self.db().updateOne(
          { messageId },
          {
            $set: {
              pendingAction: {
                type: 'search',
                query
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
      async executeUpdate(messageId, _id, updates) {
        console.log('[chatbot] executeUpdate:', { messageId, _id, updates });

        // Protected types that cannot be modified via AI
        const protectedTypes = [
          '@apostrophecms/user',
          '@apostrophecms/advanced-permission-group'
        ];

        // Look up the document to get its type
        const doc = await self.apos.doc.db.findOne({ _id });
        if (!doc) {
          return { error: `Document not found: ${_id}` };
        }

        // Check if it's a protected type
        if (protectedTypes.includes(doc.type)) {
          return { error: `Cannot modify ${doc.type} documents for security reasons` };
        }

        // Set pending action for browser to execute via REST API
        await self.db().updateOne(
          { messageId },
          {
            $set: {
              pendingAction: {
                type: 'update',
                _id,
                docType: doc.type,
                updates
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
      executeDocSchema(typeName) {
        console.log('[chatbot] executeDocSchema:', { typeName });

        // If no type specified, list all available doc types
        if (!typeName) {
          const docTypes = Object.keys(self.apos.doc.managers).filter(name => {
            const manager = self.apos.doc.managers[name];
            return manager.schema && manager.schema.length > 0;
          });

          return {
            docTypes,
            hint: 'Call doc-schema again with a specific typeName to get its full schema'
          };
        }

        const docManager = self.apos.doc.managers[typeName];
        if (docManager && docManager.schema) {
          return {
            typeName,
            schema: docManager.schema
          };
        }

        return { error: `Doc type not found: ${typeName}. Call doc-schema with no parameters to list available types.` };
      },
      executeWidgetSchema(typeName) {
        console.log('[chatbot] executeWidgetSchema:', { typeName });

        // If no type specified, list all available widget types
        if (!typeName) {
          const widgetTypes = Object.keys(self.apos.area.widgetManagers);

          return {
            widgetTypes,
            hint: 'Call widget-schema again with a specific typeName to get its full schema'
          };
        }

        // Try exact match first
        let widgetManager = self.apos.area.widgetManagers[typeName];

        if (widgetManager && widgetManager.schema) {
          return {
            typeName,
            schema: widgetManager.schema
          };
        }

        return { error: `Widget type not found: ${typeName}. Call widget-schema with no parameters to list available types.` };
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
