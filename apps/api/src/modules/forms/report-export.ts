import { FormResponseSummary } from '@pulse/contracts';
import PDFDocument from 'pdfkit';

/**
 * Report renderer built from SubmissionsService.summary()'s already-computed
 * per-field aggregates — no new aggregation logic here, just a different
 * presentation of the same data as the CSV/XLSX raw-row exports.
 */
export function buildSummaryPdf(title: string, summary: FormResponseSummary): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(20).text(title, { underline: true });
    doc.moveDown();
    doc.fontSize(11).text(`${summary.responses} response${summary.responses === 1 ? '' : 's'}`);
    if (summary.firstResponseAt) doc.text(`first: ${new Date(summary.firstResponseAt).toLocaleString()}`);
    if (summary.lastResponseAt) doc.text(`last: ${new Date(summary.lastResponseAt).toLocaleString()}`);

    if (summary.quiz) {
      doc.moveDown();
      doc.fontSize(14).text('quiz results');
      doc.fontSize(11).text(`average score: ${summary.quiz.averagePercent}%`);
      if (summary.quiz.passRate !== undefined) {
        doc.text(`pass rate: ${Math.round(summary.quiz.passRate * 100)}%`);
      }
    }

    for (const field of summary.fields) {
      doc.moveDown();
      doc.fontSize(14).text(field.label);
      doc.fontSize(10).fillColor('#555555').text(`${field.answered} answered`);
      doc.fillColor('#000000');
      for (const line of summaryLines(field)) {
        doc.fontSize(10).text(`  ${line}`);
      }
    }

    doc.end();
  });
}

function summaryLines(field: FormResponseSummary['fields'][number]): string[] {
  const lines: string[] = [];
  if (field.counts) {
    for (const [key, count] of Object.entries(field.counts)) lines.push(`${key}: ${count}`);
  }
  if (field.average !== undefined && field.average !== null) lines.push(`average: ${field.average.toFixed(2)}`);
  if (field.min !== undefined && field.min !== null) lines.push(`min: ${field.min}`);
  if (field.max !== undefined && field.max !== null) lines.push(`max: ${field.max}`);
  if (field.npsScore !== undefined) lines.push(`NPS: ${field.npsScore}`);
  if (field.samples?.length) lines.push(`recent: ${field.samples.join(' | ')}`);
  return lines;
}
