"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { spawn } = require("node:child_process");

function runPromptPreview(payload) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      /* turbopackIgnore: true */ process.env.CASTING_PYTHON_BIN || "python3",
      ["tools/tier2_prompt_preview.py"],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Prompt preview exited with ${code}.`));
        return;
      }
      try {
        const result = JSON.parse(stdout);
        if (typeof result.prompt !== "string") {
          reject(new Error("Prompt preview returned an invalid response."));
          return;
        }
        resolve(result.prompt);
      } catch {
        reject(new Error("Prompt preview returned malformed JSON."));
      }
    });
    child.stdin.end(payload);
  });
}

module.exports = { runPromptPreview };
