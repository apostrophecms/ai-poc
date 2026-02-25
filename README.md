# Apostrophe 4.x AI chatbot technology demo

This is a fork of our `public-demo` project that incorporates an AI chatbot that can:

* Update documents, usually the current page or piece, in a sophisticated way (see examples below).
* Search for other documents, to complete relationship fields.

## This is just a PoC

This is a proof-of-concept. The UI design, user experience and feature set are not final.

Here is a **partial** list of features that don't exist today, but would certainly be included in a final product:

* Support for creating documents.
* Support for generating images.
* Support for localizing documents (the chatbot does not yet understand the relationships between locales of the same document).
* Support for multiple AI providers.

Note that for this tech demo, the chatbot is contained entirely in the `chatbot` module of this project. It is not part of Apostrophe Core or an npm module. This is ideal during this experimental stage of rapid development.

## This doesn't always work

It's AI. It may do unexpected or undesirable things, or in some cases do nothing at all.

To mitigate these issues, the AI works only on drafts for document types that support it.

## This costs money to use

This demo requires a paid Anthropic API account, and currently uses the Sonnet model to maximize the quality of the results. The cost can add up with heavy use, so keep an eye on your API account usage. We recommend that you not turn on automatic reload. Creating new chats can help limit the cost. We are working to bring token counts down.

## Get started

1. Install dependencies with `npm install`.
2. Add your first user with `node app @apostrophecms/user:add {MY_USERNAME} admin`.
3. **Set your `APOS_ANTHROPIC_API_KEY` environment variable.** You will need a paid Anthropic API account.

## Running the project

* Run `npm run dev` to build the Apostrophe UI and start the site up.
* Go to: `http://localhost:3000` to log in.
* Log in.
* Click "Edit."
* Click the "Robot" icon (look at the upper right) to open the chatbot. You can click again to close it.
* Ask the chatbot to carry out an action. Here are examples that typically work well. **Note:** the fourth example assumes you already have an image in your media library, and that the title makes reference to the word "star." The chatbot does not generate new images.

```
Add a paragraph of nice things about cats.

Switch to a two-column layout, with "Point" and "Counterpoint" headings. Move this text to the "Point" column. Write your own "Counterpoint" text.

Now change the text to bulleted lists.

Now add an image of a star at the end of the article.

Add a gap between the columns.

Now set the width of the star to 50% and center it.
```

## Frequently Asked Questions

**"Why don't I see the changes it made? I can see it used tools to make changes."** Click "Edit" at upper right. The chatbot always works on the draft, so if you are viewing the published page you won't see anything right away.

**"Why didn't it work?"** AI can be unpredictable, but please share your feedback with `tom@apostrophecms.com`. Please use the subject line "Chatbot PoC feedback."

**"Why did the unit tests fail?"** See above. However, they should usually pass.

**"Why doesn't it support OpenAI/Google?"** For PoC purposes we've gone with one model, but we plan a more general-purpose AI integration in ApostropheCMS core that will allow the developer to select the model.
