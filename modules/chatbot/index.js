export default {
  options: {
    // Use compact text format for schemas (reduces tokens)
    // Set to false to use full JSON format
    compactSchema: true
  },
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
- Returns only core properties (title, slug, type, _id, aposDocId) to save tokens.
- Use get-properties to fetch specific field values after finding the document you need.
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
            },
            {
              name: 'generate-id',
              description: `Generate a unique _id for a new widget or other object.

IMPORTANT: You MUST use this tool whenever you need to create a new _id.
- Call this tool BEFORE constructing any new widget
- Never make up or guess _id values
- Each new widget needs its own unique _id from this tool`,
              input_schema: {
                type: 'object',
                properties: {},
                required: []
              }
            },
            {
              name: 'add-widget',
              description: `Add a new widget to an area in a document.

Use this instead of update when you want to ADD a widget to an area without disturbing existing widgets.
This safely inserts the widget while preserving all existing content.
Works with nested areas (e.g., areas inside layout widget columns) by finding the area by its _id.

IMPORTANT:
- Use generate-id first to get the _id for the new widget
- The widget must include _id, type, and metaType: "widget"
- position can be a number (0 = first) or "end" to append`,
              input_schema: {
                type: 'object',
                properties: {
                  docId: {
                    type: 'string',
                    description: 'The _id of the document containing the area'
                  },
                  areaId: {
                    type: 'string',
                    description: 'The _id of the area to add the widget to (found in the document structure)'
                  },
                  widget: {
                    type: 'object',
                    description: 'The complete widget object including _id, type, metaType, and all content fields'
                  },
                  position: {
                    type: ['number', 'string'],
                    description: 'Where to insert: a number (0 = first) or "end" to append. Defaults to "end".'
                  }
                },
                required: ['docId', 'areaId', 'widget']
              }
            },
            {
              name: 'delete-widget',
              description: `Delete a widget from an area in a document.

Use this to safely remove a widget without disturbing other widgets in the same area.
Works with nested areas (e.g., widgets inside layout columns) by finding the widget by its _id.

IMPORTANT:
- Only removes the specified widget, preserving all other content
- The widget is identified by its _id`,
              input_schema: {
                type: 'object',
                properties: {
                  docId: {
                    type: 'string',
                    description: 'The _id of the document containing the widget'
                  },
                  widgetId: {
                    type: 'string',
                    description: 'The _id of the widget to delete'
                  }
                },
                required: ['docId', 'widgetId']
              }
            },
            {
              name: 'get-context',
              description: `Get the current "context document" - the page or piece the user is currently viewing or editing.

Use this when:
- The user's request doesn't clearly specify which document to operate on
- The user says things like "update this page", "change the title", "add a widget here"
- The document is the implied object of the user's sentence

Do NOT use this when:
- The user clearly specifies a different document (e.g., "update the cats article")
- You already have the document from a search result

IMPORTANT:
- Returns only core properties (title, slug, type, _id, aposDocId) to save tokens.
- Use get-properties to fetch specific field values you need to read or modify.`,
              input_schema: {
                type: 'object',
                properties: {},
                required: []
              }
            },
            {
              name: 'get-properties',
              description: `Get specific property values from a document by _id.

Use this to fetch only the fields you need, reducing token usage.

IMPORTANT:
- Supports dot notation for nested fields (e.g., "main.items.0.content")
- Area fields are returned ONE LEVEL DEEP only
- Nested areas within the requested data appear as callback strings like "$callback:main.items.0.columns"
- To get nested area content, call get-properties again with the callback path (without the "$callback:" prefix)
- NEVER include $callback strings in update requests - always fetch the actual data first

Example workflow:
1. get-properties with fields: ["main"] → returns main area with $callback strings for nested areas
2. get-properties with fields: ["main.items.0.columns"] → returns the nested columns area`,
              input_schema: {
                type: 'object',
                properties: {
                  _id: {
                    type: 'string',
                    description: 'The _id of the document'
                  },
                  fields: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Array of field paths to retrieve (supports dot notation)'
                  }
                },
                required: ['_id', 'fields']
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
        async revert(req) {
          self.requireUser(req);
          const { snapshotId } = req.body;
          if (!snapshotId) {
            throw self.apos.error('invalid', 'snapshotId is required');
          }
          const snapshot = await self.snapshotDb().findOne({ _id: snapshotId });
          if (!snapshot) {
            throw self.apos.error('notfound', 'Snapshot not found');
          }
          if (self.apos.page.isPage(snapshot.doc)) {
            await self.apos.page.update(req, snapshot.doc);
          } else {
            await self.apos.doc.getManager(snapshot.docType).update(req, snapshot.doc);
          }
          // Find the message entry that triggered this mutation
          const entry = await self.db().findOne({ messageId: snapshot.messageId });
          let userMessage = '';
          if (entry) {
            userMessage = entry.userMessage || '';
            // Delete this entry and all subsequent entries in the same chat
            await self.db().deleteMany({
              chatId: entry.chatId,
              userId: req.user._id,
              createdAt: { $gte: entry.createdAt }
            });
          }
          return {
            success: true,
            userMessage: userMessage.substring(0, 80)
          };
        },
        async actionResult(req) {
          self.requireUser(req);
          const { messageId, result, snapshotId } = req.body;
          console.log('[chatbot] actionResult received:', { messageId, result: JSON.stringify(result, null, 2) });
          if (!messageId) {
            throw self.apos.error('invalid', 'messageId is required');
          }
          // If the result includes PATCH info, store a debug accordion response with snapshotId
          if (result && result.patchInfo) {
            const { url, body } = result.patchInfo;
            const bodyJson = JSON.stringify(body, null, 2);
            const charCount = bodyJson.length;
            let preview = bodyJson.substring(0, 100).replace(/\n/g, ' ');
            if (bodyJson.length > 100) {
              preview += '...';
            }
            const summary = `PATCH ${url.split('?')[0]} (${charCount.toLocaleString()} chars) — ${preview}`;
            await self.addResponse(messageId, bodyJson, false, {
              accordion: true,
              accordionSummary: summary,
              snapshotId: snapshotId || null
            });
            // Remove patchInfo from result before storing (not needed for Claude)
            delete result.patchInfo;
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
            results: orderedDocs.map(doc => self.pruneForAI(doc))
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
            pendingAction: entry.pendingAction,
            tokenUsage: {
              inputTokens: entry.totalInputTokens || 0,
              outputTokens: entry.totalOutputTokens || 0
            }
          };
        },
        async listChats(req) {
          self.requireUser(req);
          const chats = await self.db().aggregate([
            { $match: { userId: req.user._id } },
            { $sort: { createdAt: 1 } },
            {
              $group: {
                _id: '$chatId',
                preview: { $first: '$userMessage' },
                createdAt: { $first: '$createdAt' },
                lastActivity: { $last: '$createdAt' },
                messageCount: { $sum: 1 }
              }
            },
            { $sort: { lastActivity: -1 } }
          ]).toArray();
          return {
            chats: chats.map(chat => ({
              chatId: chat._id,
              preview: (chat.preview || '').substring(0, 100),
              createdAt: chat.createdAt,
              lastActivity: chat.lastActivity,
              messageCount: chat.messageCount
            }))
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
      snapshotDb() {
        return self.apos.db.collection('aposChatbotSnapshots');
      },
      async snapshotDocument(messageId, doc) {
        const snapshotId = self.apos.util.generateId();
        const pruned = self.pruneRelationships(doc);
        await self.snapshotDb().insertOne({
          _id: snapshotId,
          messageId,
          docId: pruned._id,
          docType: pruned.type,
          doc: pruned,
          createdAt: new Date()
        });
        return snapshotId;
      },
      // Recursively prune relationship arrays (properties starting with _
      // that are arrays) to only keep _id, aposDocId, type, and _fields
      pruneRelationships(obj) {
        if (Array.isArray(obj)) {
          return obj.map(item => self.pruneRelationships(item));
        }
        if (obj && typeof obj === 'object') {
          const result = {};
          for (const [key, value] of Object.entries(obj)) {
            if (key.startsWith('_') && Array.isArray(value)) {
              result[key] = value.map(entry => {
                if (!entry || typeof entry !== 'object') {
                  return entry;
                }
                const kept = {
                  _id: entry._id,
                  aposDocId: entry.aposDocId,
                  type: entry.type
                };
                if (entry._fields) {
                  kept._fields = entry._fields;
                }
                return kept;
              });
            } else if (value && typeof value === 'object') {
              result[key] = self.pruneRelationships(value);
            } else {
              result[key] = value;
            }
          }
          return result;
        }
        return obj;
      },
      requireUser(req) {
        if (!req.user) {
          throw self.apos.error('forbidden', 'Login required');
        }
      },
      // Remove auto-generated search index fields to reduce token usage
      // These are regenerated on save and not part of the actual schema
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
      // Get a value from an object using dot notation path
      getValueAtPath(obj, path) {
        const parts = path.split('.');
        let current = obj;
        for (const part of parts) {
          if (current === undefined || current === null) {
            return undefined;
          }
          current = current[part];
        }
        return current;
      },
      // Process a value for AI, replacing nested areas with $callback strings
      // basePath is the dot notation path to this value
      processForAI(value, basePath) {
        if (value === null || value === undefined) {
          return value;
        }

        // Check if this is an area (has metaType: 'area')
        if (value && typeof value === 'object' && value.metaType === 'area') {
          // Return the area but process its items
          const result = {
            _id: value._id,
            metaType: 'area',
            items: []
          };

          if (Array.isArray(value.items)) {
            result.items = value.items.map((item, index) => {
              return self.processWidgetForAI(item, `${basePath}.items.${index}`);
            });
          }

          return result;
        }

        // For non-area objects, return as-is (shallow)
        return value;
      },
      // Process a widget, replacing any nested areas with $callback strings
      processWidgetForAI(widget, basePath) {
        if (!widget || typeof widget !== 'object') {
          return widget;
        }

        const result = {};
        for (const [key, value] of Object.entries(widget)) {
          const fieldPath = `${basePath}.${key}`;

          // Check if this is a nested area
          if (value && typeof value === 'object' && value.metaType === 'area') {
            // Replace with callback string
            result[key] = `$callback:${fieldPath}`;
          } else if (Array.isArray(value)) {
            // Check array items for areas
            result[key] = value.map((item, index) => {
              if (item && typeof item === 'object' && item.metaType === 'area') {
                return `$callback:${fieldPath}.${index}`;
              }
              return item;
            });
          } else {
            result[key] = value;
          }
        }

        return result;
      },
      // Check if an object contains any $callback strings (recursive)
      findCallbackStrings(obj, path = '') {
        const found = [];

        if (typeof obj === 'string' && obj.startsWith('$callback:')) {
          found.push({ path, value: obj });
          return found;
        }

        if (Array.isArray(obj)) {
          obj.forEach((item, index) => {
            found.push(...self.findCallbackStrings(item, path ? `${path}.${index}` : `${index}`));
          });
          return found;
        }

        if (obj && typeof obj === 'object') {
          for (const [key, value] of Object.entries(obj)) {
            found.push(...self.findCallbackStrings(value, path ? `${path}.${key}` : key));
          }
        }

        return found;
      },
      async addResponse(messageId, text, final, options = {}) {
        const response = { text, final };
        if (options.accordion) {
          response.accordion = true;
          response.accordionSummary = options.accordionSummary || '';
        }
        if (options.snapshotId) {
          response.snapshotId = options.snapshotId;
        }
        await self.db().updateOne(
          { messageId },
          { $push: { responses: response } }
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
          let response = await self.callClaude(messageId, messages);
          console.log('[chatbot] Claude response:', JSON.stringify(response, null, 2));

          // Handle tool use loop
          while (response.stop_reason === 'tool_use') {
            console.log('[chatbot] Tool use detected');
            const toolUseBlocks = response.content.filter(block => block.type === 'tool_use');
            if (toolUseBlocks.length === 0) {
              console.log('[chatbot] No tool_use blocks found, breaking');
              break;
            }

            console.log('[chatbot] Executing', toolUseBlocks.length, 'tool(s)');

            // Send any intermediate text as a progress message
            const textBlock = response.content.find(block => block.type === 'text');
            if (textBlock && textBlock.text) {
              await self.addResponse(messageId, textBlock.text, false);
            }

            // Execute all tool calls and collect results
            const toolResults = [];
            for (const toolUseBlock of toolUseBlocks) {
              console.log('[chatbot] Executing tool:', toolUseBlock.name, 'with input:', toolUseBlock.input);
              const toolResult = await self.executeTool(messageId, toolUseBlock);
              console.log('[chatbot] Tool result:', JSON.stringify(toolResult, null, 2));
              toolResults.push({
                type: 'tool_result',
                tool_use_id: toolUseBlock.id,
                content: JSON.stringify(toolResult)
              });
            }

            // Continue conversation with all tool results
            messages.push({ role: 'assistant', content: response.content });
            messages.push({
              role: 'user',
              content: toolResults
            });

            console.log('[chatbot] Calling Claude again with', toolResults.length, 'tool result(s)');
            response = await self.callClaude(messageId, messages);
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
      async callClaude(messageId, messages) {
        const systemPrompt = `You are a helpful CMS assistant with access to tools for searching and updating content.

CONTEXT AWARENESS:
- When the user sends a message like 'I am now looking at: "Page Title" (type)', they have navigated to a new page.
- You MUST immediately call the get-context tool to fetch the current document's details.
- Briefly acknowledge the new context (e.g., "Got it, I can see the About Us page.") and offer to help.

CRITICAL INSTRUCTIONS:
- When the user asks you to make a change, you MUST actually USE YOUR TOOLS. Do not just describe what you would do.
- Never say "I will update..." or "Let me update..." without immediately following through with the tool call.
- If you need information first, use your tools to get it.
- After making changes, confirm what was actually done based on the tool result.
- If a tool call fails, report the actual error to the user.
- If you didn't use your tools, you didn't do anything and you need to try again!

FETCHING DATA EFFICIENTLY:
- search and get-context return ONLY core properties (title, slug, type, _id, aposDocId) to save tokens.
- Use get-properties to fetch specific fields you need by their dot-notation paths.
- get-properties returns areas ONE LEVEL DEEP. Nested areas appear as "$callback:path.to.nested.area".
- To get nested area content, call get-properties again with that path (without "$callback:" prefix).
- NEVER include $callback strings in update requests - always fetch the actual data first using get-properties.

MAKING UPDATES:
- Make MINIMAL, surgical updates. Only include the specific fields you're changing. Use add-widget
  instead of update when it is suitable.
- For simple field changes (title, slug, etc.), just update that one field.
- NEVER send back an entire document - only the fields that need to change.
- Keep your update payloads as small as possible to avoid truncation.

UPDATING EXISTING WIDGETS:
- To update a specific widget, use the update tool with an "@ reference" and the widget's _id.
- You can combine @ notation with dot notation to update specific properties: { "@widgetId.content": "<p>New text</p>" }
- This is much more efficient than replacing the entire widget.
- Examples:
  - Update just one property: { "@abc123.content": "<p>New text</p>" }
  - Update a nested property: { "@columnWidgetId.desktop.colstart": 3 }
  - Multiple updates in one call: { "@widget1.content": "...", "@widget2.desktop.colspan": 5 }
- If you DO replace an entire widget, you MUST include _id, type, and metaType.

ADDING NEW WIDGETS TO AN AREA:
- Use the add-widget tool, NOT the update tool.
- add-widget safely inserts a new widget without disturbing existing widgets.

REQUIRED STEPS BEFORE ADDING A WIDGET:
1. FIRST call widget-schema to get the exact schema for the widget type you want to add.
2. If adding nested widgets (e.g., widgets inside a layout's columns), check widget-schema for EACH nested widget type too.
3. THEN call generate-id for the main widget AND for each nested widget - every widget needs its own unique _id.
4. Construct the widget using ONLY properties from the schema - NEVER guess or invent properties.
5. The widget must include _id, type, and metaType: "widget" plus schema-defined fields.
- NEVER use update to add widgets - it risks destroying existing content.
- NEVER skip schema checks - you MUST know the exact field names before constructing ANY widget.

CREATING NEW WIDGETS OR OTHER OBJECTS:
- When creating a new widget or anything else that requires its own _id, you MUST call the generate-id tool first.
- NEVER make up or guess _id values - always use generate-id.
- Each new widget needs: _id (from generate-id), metaType: "widget", and type (the widget type name).

RELATIONSHIP FIELDS:
- To update a relationship field, pass an array of related documents to the relationship field name (e.g., _images, not imageIds).
- You cannot patch imageIds or similar ID arrays directly - use the relationship field name with underscore prefix.
- To save space, only include _id, type, and aposDocId for each related document.
- If the relationship has custom fields, include a _fields object with those values.
- Example: { "_images": [{ "_id": "abc", "type": "@apostrophecms/image", "aposDocId": "xyz" }] }

You have full permission to search, read schemas, and update content. Use your tools.`;

        const body = JSON.stringify({
          model: 'claude-sonnet-4-5-20250929',
          max_tokens: 8192,
          system: systemPrompt,
          tools: self.tools,
          messages
        });

        // Send debug message with the input (excluding system prompt)
        const messagesJson = JSON.stringify(messages, null, 2);
        const charCount = messagesJson.length;

        // Helper to find tool name by tool_use_id
        const findToolName = (toolUseId) => {
          for (const msg of messages) {
            if (msg.role === 'assistant' && Array.isArray(msg.content)) {
              const toolUse = msg.content.find(c => c.type === 'tool_use' && c.id === toolUseId);
              if (toolUse) return toolUse.name;
            }
          }
          return 'unknown';
        };

        // Build summary from the LATEST message
        const lastMessage = messages[messages.length - 1];
        let context = '';
        let preview = '';

        if (lastMessage) {
          if (lastMessage.role === 'user') {
            // Check if it's a tool result
            if (Array.isArray(lastMessage.content)) {
              const toolResult = lastMessage.content.find(c => c.type === 'tool_result');
              if (toolResult) {
                const toolName = findToolName(toolResult.tool_use_id);
                context = `result of ${toolName}`;
                // Preview the tool result content
                const resultStr = typeof toolResult.content === 'string'
                  ? toolResult.content
                  : JSON.stringify(toolResult.content);
                preview = resultStr.substring(0, 100).replace(/\n/g, ' ');
                if (resultStr.length > 100) preview += '...';
              }
            } else if (typeof lastMessage.content === 'string') {
              context = 'user message';
              preview = lastMessage.content.substring(0, 100);
              if (lastMessage.content.length > 100) preview += '...';
            }
          } else if (lastMessage.role === 'assistant') {
            // Check for tool_use in assistant message
            if (Array.isArray(lastMessage.content)) {
              const toolUse = lastMessage.content.find(c => c.type === 'tool_use');
              if (toolUse) {
                context = `after ${toolUse.name}`;
                preview = JSON.stringify(toolUse.input || {}).substring(0, 80);
                if (preview.length >= 80) preview += '...';
              }
            }
          }
        }

        const summary = `Claude input: ${charCount.toLocaleString()} chars${context ? ` (${context})` : ''}`;
        await self.addResponse(messageId, messagesJson, false, {
          accordion: true,
          accordionSummary: preview ? `${summary} — ${preview}` : summary
        });

        const makeRequest = async () => {
          const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': self.apiKey,
              'anthropic-version': '2023-06-01'
            },
            body
          });

          if (response.status === 429) {
            // Rate limited - notify user and retry after 30 seconds
            console.log('[chatbot] Rate limited (429), waiting 30 seconds before retry...');
            await self.addResponse(messageId, 'Rate limited - waiting 30 seconds...', false);
            await self.delay(30000);
            return makeRequest();
          }

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Claude API error: ${response.status} ${errorText}`);
          }

          return response.json();
        };

        const result = await makeRequest();

        if (result.usage) {
          console.log(`[chatbot] Token usage: ${result.usage.input_tokens} input, ${result.usage.output_tokens} output`);
          // Store token usage for tracking
          await self.db().updateOne(
            { messageId },
            {
              $inc: {
                totalInputTokens: result.usage.input_tokens,
                totalOutputTokens: result.usage.output_tokens
              }
            }
          );
        }

        return result;
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

        if (name === 'generate-id') {
          return { _id: self.apos.util.generateId() };
        }

        if (name === 'add-widget') {
          return self.executeAddWidget(messageId, input.docId, input.areaId, input.widget, input.position);
        }

        if (name === 'delete-widget') {
          return self.executeDeleteWidget(messageId, input.docId, input.widgetId);
        }

        if (name === 'get-context') {
          return self.executeGetContext(messageId);
        }

        if (name === 'get-properties') {
          return self.executeGetProperties(messageId, input._id, input.fields);
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
      async executeGetContext(messageId) {
        console.log('[chatbot] executeGetContext:', { messageId });

        // Set pending action for browser to fetch context document (core properties only)
        await self.db().updateOne(
          { messageId },
          {
            $set: {
              pendingAction: {
                type: 'get-context'
              },
              actionResult: null
            }
          }
        );

        // Wait for browser to execute and return result
        console.log('[chatbot] Waiting for browser action result...');
        const result = await self.waitForActionResult(messageId);
        console.log('[chatbot] Browser action result received:', JSON.stringify(result, null, 2));

        // The browser now returns core properties only
        return result;
      },
      async executeGetProperties(messageId, _id, fields) {
        console.log('[chatbot] executeGetProperties:', { messageId, _id, fields });

        // Fetch the full document from the database
        const doc = await self.apos.doc.db.findOne({ _id });
        if (!doc) {
          return { error: `Document not found: ${_id}` };
        }

        // Extract requested fields
        const result = {
          _id: doc._id,
          type: doc.type
        };

        for (const fieldPath of fields) {
          const value = self.getValueAtPath(doc, fieldPath);
          if (value !== undefined) {
            // Process the value, replacing nested areas with $callback strings
            result[fieldPath] = self.processForAI(value, fieldPath);
          } else {
            result[fieldPath] = null;
          }
        }

        return result;
      },
      async executeAddWidget(messageId, docId, areaId, widget, position) {
        console.log('[chatbot] executeAddWidget:', { messageId, docId, areaId, widget, position });

        // Look up the document to get its type
        const doc = await self.apos.doc.db.findOne({ _id: docId });
        if (!doc) {
          return { error: `Document not found: ${docId}` };
        }

        const snapshotId = await self.snapshotDocument(messageId, doc);

        // Set pending action for browser to execute

        const pendingAction = {
          type: 'add-widget',
          docId,
          docType: doc.type,
          areaId,
          widget,
          position: position ?? 'end',
          snapshotId
        };

        console.log('### ADD WIDGET:', JSON.stringify(pendingAction, null, 2));

        await self.db().updateOne(
          { messageId },
          {
            $set: {
              pendingAction,
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
      async executeDeleteWidget(messageId, docId, widgetId) {
        console.log('[chatbot] executeDeleteWidget:', { messageId, docId, widgetId });

        // Look up the document to get its type
        const doc = await self.apos.doc.db.findOne({ _id: docId });
        if (!doc) {
          return { error: `Document not found: ${docId}` };
        }

        const snapshotId = await self.snapshotDocument(messageId, doc);

        const pendingAction = {
          type: 'delete-widget',
          docId,
          docType: doc.type,
          widgetId,
          snapshotId
        };

        console.log('### DELETE WIDGET:', JSON.stringify(pendingAction, null, 2));

        await self.db().updateOne(
          { messageId },
          {
            $set: {
              pendingAction,
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

        // Check for $callback strings in updates - these indicate unfetched data
        const callbackStrings = self.findCallbackStrings(updates);
        if (callbackStrings.length > 0) {
          const paths = callbackStrings.map(c => `"${c.path}" contains "${c.value}"`).join(', ');
          return {
            error: `Cannot update with $callback placeholders. You must first fetch the actual data using get-properties with the callback path (without the "$callback:" prefix). Found: ${paths}`
          };
        }

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

        console.log('### UPDATES:', JSON.stringify(updates, null, 2));

        const snapshotId = await self.snapshotDocument(messageId, doc);

        // Set pending action for browser to execute via REST API
        await self.db().updateOne(
          { messageId },
          {
            $set: {
              pendingAction: {
                type: 'update',
                _id,
                docType: doc.type,
                updates,
                snapshotId
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
      // Convert schema to compact text format to reduce token usage
      // Format: "fieldName: type* (details)" where * = required
      schemaToCompact(schema, indent = 0) {
        if (!schema || !Array.isArray(schema)) {
          return '';
        }
        const pad = '  '.repeat(indent);
        const lines = [];

        for (const field of schema) {
          const parts = [field.name, ': ', field.type];

          // Mark required fields
          if (field.required) {
            parts.push('*');
          }

          // Add type-specific details
          const details = [];

          // Relationship target type
          if (field.withType) {
            details.push(`-> ${field.withType}`);
          }

          // Select/radio/checkboxes choices
          if (field.choices && Array.isArray(field.choices)) {
            const values = field.choices.map(c => c.value).join('|');
            details.push(`[${values}]`);
          }

          // Area widgets
          if (field.options?.widgets) {
            const widgetTypes = Object.keys(field.options.widgets).join(', ');
            details.push(`widgets: ${widgetTypes}`);
          }

          // Numeric constraints
          if (field.min !== undefined) {
            details.push(`min:${field.min}`);
          }
          if (field.max !== undefined) {
            details.push(`max:${field.max}`);
          }

          // Array/object nested schema
          if (field.schema && field.schema.length > 0) {
            const nested = self.schemaToCompact(field.schema, indent + 1);
            if (nested) {
              details.push(`{\n${nested}\n${pad}}`);
            }
          }

          if (details.length > 0) {
            parts.push(' (', details.join(', '), ')');
          }

          lines.push(pad + parts.join(''));
        }

        return lines.join('\n');
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
          if (self.options.compactSchema) {
            return {
              typeName,
              schema: self.schemaToCompact(docManager.schema),
              format: 'fieldName: type* (details) where * = required'
            };
          } else {
            return {
              typeName,
              schema: docManager.schema
            };
          }
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
        const widgetManager = self.apos.area.widgetManagers[typeName];

        if (!widgetManager) {
          return { error: `Widget type not found: ${typeName}. Call widget-schema with no parameters to list available types.` };
        }

        // Use getAiSchema() if available, otherwise use the full schema
        const schema = (typeof widgetManager.getAiSchema === 'function')
          ? widgetManager.getAiSchema()
          : (widgetManager.schema || []);

        // Get optional aiSkill hint
        const aiSkill = widgetManager.options?.aiSkill;

        if (self.options.compactSchema) {
          // Built-in fields that all widgets have
          const builtIn = '_id: string* (auto-generated), type: string* (widget type name), metaType: string* (always "widget")';

          // Some widgets have special built-in content fields not in their schema
          const specialFields = {
            '@apostrophecms/rich-text': 'content: string* (HTML content)'
          };

          const schemaText = self.schemaToCompact(schema);
          const special = specialFields[typeName] || '';

          const parts = [builtIn];
          if (special) {
            parts.push(special);
          }
          if (schemaText) {
            parts.push(schemaText);
          }

          const result = {
            typeName,
            schema: parts.join('\n'),
            format: 'fieldName: type* (details) where * = required'
          };
          if (aiSkill) {
            result.aiSkill = aiSkill;
          }
          return result;
        } else {
          // JSON format
          // Add built-in fields to schema for completeness
          const builtInFields = [
            { name: '_id', type: 'string', required: true, help: 'Auto-generated unique ID' },
            { name: 'type', type: 'string', required: true, help: 'Widget type name' },
            { name: 'metaType', type: 'string', required: true, help: 'Always "widget"' }
          ];

          // Special fields for certain widget types
          const specialFields = {
            '@apostrophecms/rich-text': [
              { name: 'content', type: 'string', required: true, help: 'HTML content' }
            ]
          };

          const fullSchema = [
            ...builtInFields,
            ...(specialFields[typeName] || []),
            ...schema
          ];

          const result = {
            typeName,
            schema: fullSchema
          };
          if (aiSkill) {
            result.aiSkill = aiSkill;
          }
          return result;
        }
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
