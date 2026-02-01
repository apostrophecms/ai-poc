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
              name: 'get-context',
              description: `Get the current "context document" - the page or piece the user is currently viewing or editing.

Use this when:
- The user's request doesn't clearly specify which document to operate on
- The user says things like "update this page", "change the title", "add a widget here"
- The document is the implied object of the user's sentence

Do NOT use this when:
- The user clearly specifies a different document (e.g., "update the cats article")
- You already have the document from a search result

Returns the full current document with all fields, or an error if there is no context document.`,
              input_schema: {
                type: 'object',
                properties: {},
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

UPDATING EXISTING WIDGETS:
- To update a specific widget, use the update tool with an "@ reference" and the widget's _id.
- Format: { "@widgetIdHere": { ...all widget properties... } }
- Avoid using the @ syntax twice in a single request. Break that up over multiple requests.
- You MUST include ALL properties of the widget, including _id, type, and metaType.
- Example: { "@abc123": { "_id": "abc123", "type": "@apostrophecms/rich-text", "metaType": "widget", "content": "<p>New text</p>" } }
- NEVER omit _id, type, or metaType - the widget will break without them.

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

        if (name === 'get-context') {
          return self.executeGetContext(messageId);
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

        // Set pending action for browser to fetch context document
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
        return result;
      },
      async executeAddWidget(messageId, docId, areaId, widget, position) {
        console.log('[chatbot] executeAddWidget:', { messageId, docId, areaId, widget, position });

        // Look up the document to get its type
        const doc = await self.apos.doc.db.findOne({ _id: docId });
        if (!doc) {
          return { error: `Document not found: ${docId}` };
        }

        // Set pending action for browser to execute

        const pendingAction = {
          type: 'add-widget',
          docId,
          docType: doc.type,
          areaId,
          widget,
          position: position ?? 'end'
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

        console.log('### UPDATES:', JSON.stringify(updates, null, 2));

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
