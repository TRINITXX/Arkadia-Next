import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import ChatMarkdown from "./ChatMarkdown";

describe("ChatMarkdown code blocks", () => {
  it("renders code block actions below the code content", () => {
    const markup = renderToStaticMarkup(
      <ChatMarkdown text={"```text\nconst value = 1;\n```"} cwd={undefined} />,
    );
    const codeBlockStart = markup.indexOf('class="chat-markdown-codeblock');
    const codeContentStart = markup.indexOf("<pre", codeBlockStart);
    const toolbarStart = markup.indexOf('role="toolbar"', codeBlockStart);

    expect(codeBlockStart).toBeGreaterThanOrEqual(0);
    expect(codeContentStart).toBeGreaterThan(codeBlockStart);
    expect(toolbarStart).toBeGreaterThan(codeContentStart);
    expect(markup).toContain("chat-markdown-codeblock-footer");
  });
});
