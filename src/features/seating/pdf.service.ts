import PDFDocument from 'pdfkit';
import { SeatingTableDTO } from './schemas';
import {
  InvitationCodeDTO,
  formatGuestMealSelections,
  formatGuestCustomAnswers,
} from '@/features/registry';
import {
  computeSeatPosition,
  resolveDetailedSeatAssignments,
  resolveSeatAssignments,
} from './seatLayout';
import {
  getDietaryBadges,
  getGuestCompanionNames,
  getGuestsHeadcount,
} from './utils/seatingHelpers';

interface GeneratePdfOptions {
  siteTitle?: string;
  weddingDate?: string;
}

/**
 * Generates a high-resolution vector PDF document containing a visual floorplan schematic
 * on page 1 and formatted table guest rosters on subsequent pages.
 */
export async function generateSeatingChartPdf(
  tables: SeatingTableDTO[],
  unassignedGuests: InvitationCodeDTO[],
  options: GeneratePdfOptions = {}
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'LETTER', // 612 x 792 points
        margin: 36, // 0.5 inch margins
        bufferPages: true, // Enable buffered pages for page number pass
        info: {
          Title: options.siteTitle ? `${options.siteTitle} - Seating Chart` : 'Wedding Seating Chart',
          Author: 'Wedding Website System',
          Subject: 'Seating Chart Floorplan & Guest Rosters',
        },
      });

      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', (err: Error) => reject(err));

      const pageWidth = 612;
      const pageHeight = 792;
      const margin = 36;
      const contentWidth = pageWidth - margin * 2; // 540 pt

      const siteTitle = options.siteTitle || 'Wedding Reception Seating Chart';
      const formattedDate = options.weddingDate || new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });

      // Calculate total stats using party headcounts
      let totalCapacity = 0;
      let totalSeated = 0;
      tables.forEach((t) => {
        totalCapacity += t.capacity;
        totalSeated += getGuestsHeadcount(t.invitationCodes || []);
      });
      const unassignedCount = getGuestsHeadcount(unassignedGuests);

      // ==========================================
      // PAGE 1: VISUAL FLOORPLAN SCHEMATIC
      // ==========================================

      // Document Header
      doc.fontSize(18).font('Helvetica-Bold').fillColor('#0f172a').text(siteTitle, margin, margin);
      doc.fontSize(9).font('Helvetica').fillColor('#64748b').text(`Exported on ${formattedDate}`, margin, margin + 22);

      // Summary Stats Box
      const statsY = margin + 38;
      const statsHeight = 28;
      doc.rect(margin, statsY, contentWidth, statsHeight).fillAndStroke('#f8fafc', '#e2e8f0');

      doc.fontSize(9).font('Helvetica-Bold').fillColor('#334155');
      const statText = `Total Tables: ${tables.length}   |   Seated Guests: ${totalSeated} / ${totalCapacity} Capacity   |   Unassigned Guests: ${unassignedCount}`;
      doc.text(statText, margin + 12, statsY + 9, { width: contentWidth - 24, align: 'center' });

      // Floorplan Schematic Canvas Box
      const canvasTop = statsY + statsHeight + 14;
      const canvasHeight = 520;
      doc.rect(margin, canvasTop, contentWidth, canvasHeight).fillAndStroke('#fafafa', '#cbd5e1');

      // Grid background dots/lines simulation or title label
      doc.fontSize(8).font('Helvetica-Bold').fillColor('#94a3b8').text('FLOORPLAN SCHEMATIC', margin + 10, canvasTop + 8);

      if (tables.length === 0) {
        // Zero-state on Page 1
        doc.fontSize(12).font('Helvetica-Oblique').fillColor('#64748b').text(
          'No seating tables configured yet.',
          margin,
          canvasTop + canvasHeight / 2 - 10,
          { align: 'center', width: contentWidth }
        );
      } else {
        // Calculate floorplan bounding box for auto-scaling
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;

        tables.forEach((t) => {
          const w = t.width || 120;
          const h = t.height || 120;
          if (t.x < minX) minX = t.x;
          if (t.y < minY) minY = t.y;
          if (t.x + w > maxX) maxX = t.x + w;
          if (t.y + h > maxY) maxY = t.y + h;
        });

        // Add perimeter padding around bounding box for seat circles
        const padding = 50;
        minX -= padding;
        minY -= padding;
        maxX += padding;
        maxY += padding;

        const bboxWidth = Math.max(100, maxX - minX);
        const bboxHeight = Math.max(100, maxY - minY);

        // Printable inner canvas bounds inside canvas box
        const innerMargin = 20;
        const drawAreaLeft = margin + innerMargin;
        const drawAreaTop = canvasTop + 24 + innerMargin;
        const drawAreaWidth = contentWidth - innerMargin * 2;
        const drawAreaHeight = canvasHeight - 24 - innerMargin * 2;

        const scaleX = drawAreaWidth / bboxWidth;
        const scaleY = drawAreaHeight / bboxHeight;
        const scale = Math.min(scaleX, scaleY, 1.2); // Cap max scale at 1.2

        // Center content in draw area
        const scaledBboxW = bboxWidth * scale;
        const scaledBboxH = bboxHeight * scale;
        const offsetX = drawAreaLeft + (drawAreaWidth - scaledBboxW) / 2 - minX * scale;
        const offsetY = drawAreaTop + (drawAreaHeight - scaledBboxH) / 2 - minY * scale;

        // Draw each table vector shape
        tables.forEach((table) => {
          const tw = (table.width || 120) * scale;
          const th = (table.height || 120) * scale;
          const tx = offsetX + table.x * scale;
          const ty = offsetY + table.y * scale;

          const shapeLower = (table.shape || 'round').toLowerCase();
          const isRound = shapeLower === 'round';
          const assignedCount = getGuestsHeadcount(table.invitationCodes || []);
          const isOverCapacity = assignedCount > table.capacity;

          const fillColor = isOverCapacity ? '#fef2f2' : '#ffffff';
          const strokeColor = isOverCapacity ? '#ef4444' : '#475569';

          // Resolve explicit, clamped, and companion seat assignments
          const seatMap = resolveSeatAssignments(table.invitationCodes, table.capacity);

          if (isRound) {
            const radius = Math.min(tw, th) / 2;
            const cx = tx + tw / 2;
            const cy = ty + th / 2;

            doc.circle(cx, cy, radius).fillAndStroke(fillColor, strokeColor);

            // Table text
            doc.fontSize(Math.max(7, Math.min(10, 10 * scale)))
              .font('Helvetica-Bold')
              .fillColor('#0f172a')
              .text(table.name, cx - radius + 2, cy - 8, {
                width: radius * 2 - 4,
                align: 'center',
              });

            doc.fontSize(Math.max(6, Math.min(8, 8 * scale)))
              .font('Helvetica')
              .fillColor(isOverCapacity ? '#dc2626' : '#64748b')
              .text(`${assignedCount}/${table.capacity} seats`, cx - radius + 2, cy + 3, {
                width: radius * 2 - 4,
                align: 'center',
              });

            // Draw seat indicators around circle
            const seatOffset = 12 * scale;
            const seatDotRadius = Math.max(3, 4.5 * scale);

            for (let i = 1; i <= table.capacity; i++) {
              const { x: sx, y: sy } = computeSeatPosition({
                shape: shapeLower,
                seatNumber: i,
                capacity: table.capacity,
                width: tw,
                height: th,
                offset: seatOffset,
                originX: tx,
                originY: ty,
              });

              const guest = seatMap.get(i);
              const isSeated = !!guest;
              const guestBadges = guest
                ? getDietaryBadges(guest.dietaryNotes, guest.extraFields, guest.partyTags)
                : [];

              if (isSeated) {
                doc.circle(sx, sy, seatDotRadius).fillAndStroke(
                  guestBadges.length > 0 ? '#047857' : '#0284c7',
                  guestBadges.length > 0 ? '#065f46' : '#0369a1'
                );
              } else {
                doc.circle(sx, sy, seatDotRadius).fillAndStroke('#ffffff', '#94a3b8');
              }
            }
          } else {
            // Rectangular, square, head, or sweetheart table
            doc.roundedRect(tx, ty, tw, th, Math.max(3, 6 * scale)).fillAndStroke(fillColor, strokeColor);

            doc.fontSize(Math.max(7, Math.min(10, 10 * scale)))
              .font('Helvetica-Bold')
              .fillColor('#0f172a')
              .text(table.name, tx + 2, ty + th / 2 - 8, {
                width: tw - 4,
                align: 'center',
              });

            doc.fontSize(Math.max(6, Math.min(8, 8 * scale)))
              .font('Helvetica')
              .fillColor(isOverCapacity ? '#dc2626' : '#64748b')
              .text(`${assignedCount}/${table.capacity} seats`, tx + 2, ty + th / 2 + 3, {
                width: tw - 4,
                align: 'center',
              });

            // Draw seat dots (along 1 side for head/sweetheart, or 4-sided perimeter for rectangular/square)
            const seatDotRadius = Math.max(3, 4.5 * scale);
            const cap = table.capacity;
            const offset = 10 * scale;

            for (let i = 1; i <= cap; i++) {
              const { x: sx, y: sy } = computeSeatPosition({
                shape: shapeLower,
                seatNumber: i,
                capacity: cap,
                width: tw,
                height: th,
                offset,
                originX: tx,
                originY: ty,
              });

              const guest = seatMap.get(i);
              const isSeated = !!guest;
              const guestBadges = guest
                ? getDietaryBadges(guest.dietaryNotes, guest.extraFields, guest.partyTags)
                : [];

              if (isSeated) {
                doc.circle(sx, sy, seatDotRadius).fillAndStroke(
                  guestBadges.length > 0 ? '#047857' : '#0284c7',
                  guestBadges.length > 0 ? '#065f46' : '#0369a1'
                );
              } else {
                doc.circle(sx, sy, seatDotRadius).fillAndStroke('#ffffff', '#94a3b8');
              }
            }
          }
        });
      }

      // Floorplan Legend at bottom of canvas
      const legendY = canvasTop + canvasHeight + 10;
      doc.fontSize(8).font('Helvetica-Bold').fillColor('#475569').text('LEGEND:', margin, legendY);

      // Assigned seat legend item
      doc.circle(margin + 50, legendY + 3, 4).fillAndStroke('#0284c7', '#0369a1');
      doc.fontSize(8).font('Helvetica').fillColor('#334155').text('Assigned Seat', margin + 58, legendY);

      // Unassigned seat legend item
      doc.circle(margin + 135, legendY + 3, 4).fillAndStroke('#ffffff', '#94a3b8');
      doc.fontSize(8).font('Helvetica').fillColor('#334155').text('Available Seat', margin + 143, legendY);

      // Over capacity legend item
      doc.rect(margin + 220, legendY, 12, 8).fillAndStroke('#fef2f2', '#ef4444');
      doc.fontSize(8).font('Helvetica').fillColor('#334155').text('Over Capacity Warning', margin + 236, legendY);

      // Dietary restriction seat legend item
      doc.circle(margin + 355, legendY + 3, 4).fillAndStroke('#047857', '#065f46');
      doc.fontSize(8).font('Helvetica').fillColor('#334155').text('Dietary Restriction', margin + 363, legendY);


      // ==========================================
      // PAGE 2+: TABLE BREAKDOWN & GUEST ROSTERS
      // ==========================================

      doc.addPage();

      let currentY = margin;

      const checkPageBreak = (neededHeight: number) => {
        if (currentY + neededHeight > pageHeight - margin - 20) {
          doc.addPage();
          currentY = margin;
          return true;
        }
        return false;
      };

      doc.fontSize(16).font('Helvetica-Bold').fillColor('#0f172a').text('Table Seating Rosters', margin, currentY);
      currentY += 24;

      if (tables.length === 0 && unassignedGuests.length === 0) {
        doc.fontSize(10).font('Helvetica-Oblique').fillColor('#64748b').text('No tables or guest records found.', margin, currentY);
      } else {
        // Table columns width definition
        const colSeatW = 50;
        const colNameW = 190;
        const colCodeW = 120;
        const colDietW = 180;

        for (const table of tables) {
          const guests = table.invitationCodes || [];
          const seatedHeadcount = getGuestsHeadcount(guests);
          const detailedSeatEntries = Array.from(
            resolveDetailedSeatAssignments(guests, table.capacity).values()
          ).sort((a, b) => a.seatNumber - b.seatNumber);
          const rowCount = Math.max(1, detailedSeatEntries.length);
          const tableBlockHeight = 24 + 18 + rowCount * 18 + 10; // Header + Col Header + Rows + Margin

          checkPageBreak(Math.min(tableBlockHeight, 150));

          // Table Banner Header
          doc.rect(margin, currentY, contentWidth, 22).fillAndStroke('#0f172a', '#0f172a');
          const shapeLabel = (table.shape || 'round').toUpperCase();
          const tableHeaderText = `${table.name}   (${shapeLabel}  |  Capacity: ${table.capacity}  |  Seated: ${seatedHeadcount})`;
          doc.fontSize(10).font('Helvetica-Bold').fillColor('#ffffff').text(tableHeaderText, margin + 8, currentY + 6);
          currentY += 22;

          // Column Header Row
          doc.rect(margin, currentY, contentWidth, 18).fillAndStroke('#e2e8f0', '#cbd5e1');
          doc.fontSize(8).font('Helvetica-Bold').fillColor('#334155');
          doc.text('Seat #', margin + 6, currentY + 5, { width: colSeatW });
          doc.text('Guest Name', margin + colSeatW + 6, currentY + 5, { width: colNameW });
          doc.text('Invitation Code', margin + colSeatW + colNameW + 6, currentY + 5, { width: colCodeW });
          doc.text('Dietary / Special Notes', margin + colSeatW + colNameW + colCodeW + 6, currentY + 5, { width: colDietW });
          currentY += 18;

          // Guest & Companion Seat Rows
          if (detailedSeatEntries.length === 0) {
            doc.rect(margin, currentY, contentWidth, 18).fillAndStroke('#ffffff', '#e2e8f0');
            doc.fontSize(8).font('Helvetica-Oblique').fillColor('#94a3b8');
            doc.text('(No guests assigned to this table)', margin + 6, currentY + 5);
            currentY += 18;
          } else {
            for (let idx = 0; idx < detailedSeatEntries.length; idx++) {
              const entry = detailedSeatEntries[idx];
              const { guest, seatNumber, isCompanion, displayName } = entry;

              let dietaryText = '—';
              if (!isCompanion) {
                const mealSelections = formatGuestMealSelections(guest);
                const customAnswers = formatGuestCustomAnswers(guest);
                const dietaryBadges = getDietaryBadges(
                  guest.dietaryNotes,
                  guest.extraFields,
                  guest.partyTags
                );
                const dietaryPrefix =
                  dietaryBadges.length > 0
                    ? `[${dietaryBadges.map((b) => b.shortLabel).join(', ')}]`
                    : '';
                const baseDietLine = guest.dietaryNotes
                  ? `${dietaryPrefix ? `${dietaryPrefix} ` : ''}${guest.dietaryNotes}`
                  : dietaryPrefix;
                const detailLines = [
                  baseDietLine,
                  mealSelections ? `Meals: ${mealSelections}` : '',
                  customAnswers ? `Responses: ${customAnswers}` : '',
                ].filter(Boolean);
                dietaryText = detailLines.length > 0 ? detailLines.join('\n') : '—';
              }

              doc.fontSize(8).font('Helvetica');
              const nameTextH = doc.heightOfString(displayName, { width: colNameW - 6 });
              const dietTextH = doc.heightOfString(dietaryText, { width: colDietW - 6 });
              const rowHeight = Math.max(18, Math.ceil(Math.max(nameTextH, dietTextH)) + 8);

              checkPageBreak(rowHeight + 2);

              const bg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
              doc.rect(margin, currentY, contentWidth, rowHeight).fillAndStroke(bg, '#e2e8f0');

              doc.fontSize(8).font('Helvetica').fillColor('#1e293b');
              const seatDisplay = `Seat ${seatNumber}`;
              doc.text(seatDisplay, margin + 6, currentY + 5, { width: colSeatW - 6 });
              doc.text(displayName, margin + colSeatW + 6, currentY + 5, {
                width: colNameW - 6,
              });
              doc
                .font('Courier')
                .text(guest.code, margin + colSeatW + colNameW + 6, currentY + 5, {
                  width: colCodeW - 6,
                });
              doc
                .font('Helvetica')
                .text(dietaryText, margin + colSeatW + colNameW + colCodeW + 6, currentY + 5, {
                  width: colDietW - 6,
                });

              currentY += rowHeight;
            }
          }

          currentY += 12; // Gap between tables
        }

        // Unassigned Guests Section
        if (unassignedGuests.length > 0) {
          checkPageBreak(60);

          doc.rect(margin, currentY, contentWidth, 22).fillAndStroke('#475569', '#475569');
          doc.fontSize(10).font('Helvetica-Bold').fillColor('#ffffff').text(`Unassigned Guests (${unassignedCount})`, margin + 8, currentY + 6);
          currentY += 22;

          doc.rect(margin, currentY, contentWidth, 18).fillAndStroke('#e2e8f0', '#cbd5e1');
          doc.fontSize(8).font('Helvetica-Bold').fillColor('#334155');
          doc.text('Guest Name', margin + 6, currentY + 5, { width: colNameW + colSeatW });
          doc.text('Invitation Code', margin + colSeatW + colNameW + 6, currentY + 5, { width: colCodeW });
          doc.text('Dietary / Special Notes', margin + colSeatW + colNameW + colCodeW + 6, currentY + 5, { width: colDietW });
          currentY += 18;

          for (let idx = 0; idx < unassignedGuests.length; idx++) {
            const guest = unassignedGuests[idx];
            const companions = getGuestCompanionNames(guest);
            const guestDisplay =
              companions.length > 0
                ? `${guest.guestName} (+${companions.length}: ${companions.join(', ')})`
                : guest.guestName;
            const mealSelections = formatGuestMealSelections(guest);
            const customAnswers = formatGuestCustomAnswers(guest);
            const unassignedBadges = getDietaryBadges(
              guest.dietaryNotes,
              guest.extraFields,
              guest.partyTags
            );
            const unassignedPrefix =
              unassignedBadges.length > 0
                ? `[${unassignedBadges.map((b) => b.shortLabel).join(', ')}]`
                : '';
            const baseUnassignedDiet = guest.dietaryNotes
              ? `${unassignedPrefix ? `${unassignedPrefix} ` : ''}${guest.dietaryNotes}`
              : unassignedPrefix;
            const unassignedDetailLines = [
              baseUnassignedDiet,
              mealSelections ? `Meals: ${mealSelections}` : '',
              customAnswers ? `Responses: ${customAnswers}` : '',
            ].filter(Boolean);
            const unassignedDietText =
              unassignedDetailLines.length > 0 ? unassignedDetailLines.join('\n') : '—';

            doc.fontSize(8).font('Helvetica');
            const unassignedNameH = doc.heightOfString(guestDisplay, {
              width: colNameW + colSeatW - 6,
            });
            const unassignedDietH = doc.heightOfString(unassignedDietText, {
              width: colDietW - 6,
            });
            const unassignedRowHeight = Math.max(
              18,
              Math.ceil(Math.max(unassignedNameH, unassignedDietH)) + 8
            );

            checkPageBreak(unassignedRowHeight + 2);

            const bg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
            doc
              .rect(margin, currentY, contentWidth, unassignedRowHeight)
              .fillAndStroke(bg, '#e2e8f0');

            doc.fontSize(8).font('Helvetica').fillColor('#1e293b');
            doc.text(guestDisplay, margin + 6, currentY + 5, {
              width: colNameW + colSeatW - 6,
            });
            doc
              .font('Courier')
              .text(guest.code, margin + colSeatW + colNameW + 6, currentY + 5, {
                width: colCodeW - 6,
              });
            doc
              .font('Helvetica')
              .text(unassignedDietText, margin + colSeatW + colNameW + colCodeW + 6, currentY + 5, {
                width: colDietW - 6,
              });

            currentY += unassignedRowHeight;
          }
        }
      }

      // ==========================================
      // PAGE NUMBERING PASS ACROSS ALL BUFFERED PAGES
      // ==========================================
      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);

        // Page footer line
        doc.moveTo(margin, pageHeight - margin).lineTo(pageWidth - margin, pageHeight - margin).stroke('#cbd5e1');

        doc.fontSize(8).font('Helvetica').fillColor('#64748b');
        doc.text(
          `Page ${i + 1} of ${range.count}`,
          margin,
          pageHeight - margin + 6,
          { align: 'right', width: contentWidth }
        );

        doc.text(
          `${siteTitle} — Confidential & Printable Event Floorplan`,
          margin,
          pageHeight - margin + 6,
          { align: 'left', width: contentWidth - 100 }
        );
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
