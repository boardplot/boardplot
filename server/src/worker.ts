/**
 * One render worker process. It loads the engine once,
 * then answers one job at a time over the IPC channel. The render verb and the
 * native PNG rasterizer are synchronous, and terminating a worker thread stops
 * JavaScript only, so the server kills this whole process at the deadline.
 */
import { loadRasterFonts } from '../../src/cli/resvg';
import { chartTool, describeTool, exportTool, viewTool, type AppsSupport, type ChartInput, type ExportInput, type ToolResult, type ViewInput } from './engine';

export type Job =
  | { op: 'describe'; input: { type?: string; variant?: string } }
  | { op: 'chart'; input: ChartInput; apps: AppsSupport }
  | { op: 'view'; input: ViewInput }
  | { op: 'export'; input: ExportInput };

function run(job: Job): ToolResult {
  switch (job.op) {
    case 'describe': return describeTool(job.input);
    case 'chart': return chartTool(job.input, job.apps);
    case 'view': return viewTool(job.input);
    case 'export': return exportTool(job.input);
  }
}

const send = process.send?.bind(process);
if (send) {
  await loadRasterFonts();
  process.on('message', (message: { id: number; job: Job }) => {
    try {
      send({ id: message.id, result: run(message.job) });
    } catch (error) {
      send({ id: message.id, error: error instanceof Error ? error.message : String(error) });
    }
  });
  // The parent going away ends this process; nothing else keeps it alive.
  process.on('disconnect', () => process.exit(0));
  send({ ready: true });
}
