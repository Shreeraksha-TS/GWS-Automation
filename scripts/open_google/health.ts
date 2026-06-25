import type { TaskContext } from "../../common/types.js";

// Auto-generated starter for "Website Health". Edit this to implement your automation.
export async function run({ page, params, outputDir, log, step }: TaskContext): Promise<void> {
  log("INFO", `Params: ${JSON.stringify(params)}`);

  // TODO: add your automation steps here.

  await step("Screenshot", () => page.screenshot({ path: `${outputDir}/screenshot.png` }));
}
