/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/common";
import { marked } from "marked";

const renderer = new marked.Renderer();

renderer.code = ({ text, lang }) => {
  const language = lang && hljs.getLanguage(lang) ? lang : undefined;
  const highlighted = language ? hljs.highlight(text, { language }).value : hljs.highlightAuto(text).value;
  const languageClass = language ? ` language-${language}` : "";

  return `<pre class="agent-code"><code class="hljs${languageClass}">${highlighted}</code></pre>`;
};

marked.setOptions({
  breaks: true,
  gfm: true,
  renderer,
});

export const renderAiAgentMarkdown = (markdown: string) => ({
  __html: DOMPurify.sanitize(marked.parse(markdown) as string),
});
