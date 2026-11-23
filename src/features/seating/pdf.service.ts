import PDFDocument from 'pdfkit';
import { SeatingTableDTO } from './schemas';
import {
  InvitationCodeDTO,
  formatGuestCustomAnswers,
  formatGuestMealSelections,
} from '@/features/registry';
import {
  computeScaledTableDimensions,
  computeSeatPosition,
  resolveDetailedSeatAssignments,
} from './seatLayout';
import {
  computeTableMealCounts,
  getDietaryBadges,
  getGuestCompanionNames,
  getGuestsHeadcount,
  getInvitationPartyMembers,
  getSeatingShapeLabel,
  isLandmarkTable,
  type DietaryBadgeInfo,
} from './utils/seatingHelpers';

export interface GeneratePdfOptions {
  siteTitle?: string;
  weddingDate?: string;
}

export type AveryCardMode = 'place-cards' | 'escort-cards';

interface AveryCardEntry {
  attendeeName: string;
  tableName: string;
  seatNumber: number;
  mealChoice: string | null;
  dietaryBadges: DietaryBadgeInfo[];
  isPlusOne: boolean;
}

/**
 * Generates a high-resolution vector PDF document containing a visual floorplan schematic
 * on page 1 and caterer-safe table guest & entrée rosters on subsequent pages.
 * Secret invitation codes (`guest.code`) are strictly excluded.
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
        bufferPages: true,
        compress: false,
        info: {
          Title: options.siteTitle ? `${options.siteTitle} - Seating Chart` : 'Wedding Seating Chart',
          Author: 'Wedding Website System',
          Subject: 'Seating Chart Floorplan & Caterer Entrée Rosters',
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
      const formattedDate =
        options.weddingDate ||
        new Date().toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        });

      const guestTables = tables.filter((t) => !isLandmarkTable(t));
      const landmarkTables = tables.filter((t) => isLandmarkTable(t));

      // Calculate total stats using party headcounts
      let totalCapacity = 0;
      let totalSeated = 0;
      guestTables.forEach((t) => {
        totalCapacity += t.capacity;
        totalSeated += getGuestsHeadcount(t.invitationCodes || []);
      });
      const unassignedCount = getGuestsHeadcount(unassignedGuests);

      // ==========================================
      // PAGE 1: VISUAL FLOORPLAN SCHEMATIC
      // ==========================================
      doc.fontSize(18).font('Helvetica-Bold').fillColor('#0f172a').text(siteTitle, margin, margin);
      doc
        .fontSize(9)
        .font('Helvetica')
        .fillColor('#64748b')
        .text(`Exported on ${formattedDate}`, margin, margin + 22);

      const statsY = margin + 38;
      const statsHeight = 28;
      doc.rect(margin, statsY, contentWidth, statsHeight).fillAndStroke('#f8fafc', '#e2e8f0');

      doc.fontSize(9).font('Helvetica-Bold').fillColor('#334155');
      const landmarkStatSuffix =
        landmarkTables.length > 0 ? ` (+${landmarkTables.length} Landmarks)` : '';
      const statText = `Guest Tables: ${guestTables.length}${landmarkStatSuffix}   |   Seated Guests: ${totalSeated} / ${totalCapacity} Capacity   |   Unassigned Invitations: ${unassignedCount}`;
      doc.text(statText, margin + 12, statsY + 9, { width: contentWidth - 24, align: 'center' });

      const canvasTop = statsY + statsHeight + 14;
      const canvasHeight = 520;
      doc.rect(margin, canvasTop, contentWidth, canvasHeight).fillAndStroke('#fafafa', '#cbd5e1');

      doc
        .fontSize(8)
        .font('Helvetica-Bold')
        .fillColor('#94a3b8')
        .text('FLOORPLAN SCHEMATIC', margin + 10, canvasTop + 8);

      if (tables.length === 0) {
        doc
          .fontSize(12)
          .font('Helvetica-Oblique')
          .fillColor('#64748b')
          .text('No seating tables configured yet.', margin, canvasTop + canvasHeight / 2 - 10, {
            align: 'center',
            width: contentWidth,
          });
      } else {
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;

        tables.forEach((t) => {
          const { width: w, height: h } = computeScaledTableDimensions({
            shape: t.shape,
            capacity: t.capacity,
            width: t.width,
            height: t.height,
            rotation: t.rotation,
          });
          if (t.x < minX) minX = t.x;
          if (t.y < minY) minY = t.y;
          if (t.x + w > maxX) maxX = t.x + w;
          if (t.y + h > maxY) maxY = t.y + h;
        });

        const padding = 50;
        minX -= padding;
        minY -= padding;
        maxX += padding;
        maxY += padding;

        const bboxWidth = Math.max(100, maxX - minX);
        const bboxHeight = Math.max(100, maxY - minY);

        const innerMargin = 20;
        const drawAreaLeft = margin + innerMargin;
        const drawAreaTop = canvasTop + 24 + innerMargin;
        const drawAreaWidth = contentWidth - innerMargin * 2;
        const drawAreaHeight = canvasHeight - 24 - innerMargin * 2;

        const scaleX = drawAreaWidth / bboxWidth;
        const scaleY = drawAreaHeight / bboxHeight;
        const scale = Math.min(scaleX, scaleY, 1.2);

        const scaledBboxW = bboxWidth * scale;
        const scaledBboxH = bboxHeight * scale;
        const offsetX = drawAreaLeft + (drawAreaWidth - scaledBboxW) / 2 - minX * scale;
        const offsetY = drawAreaTop + (drawAreaHeight - scaledBboxH) / 2 - minY * scale;

        tables.forEach((table) => {
          const scaledBounds = computeScaledTableDimensions({
            shape: table.shape,
            capacity: table.capacity,
            width: table.width,
            height: table.height,
            rotation: table.rotation,
          });
          const tw = scaledBounds.width * scale;
          const th = scaledBounds.height * scale;
          const tx = offsetX + table.x * scale;
          const ty = offsetY + table.y * scale;
          const shapeLower = (table.shape || 'round').toLowerCase();

          if (isLandmarkTable(table)) {
            const cornerRadius =
              shapeLower === 'cake' ? Math.min(tw, th) / 2 : Math.max(3, 6 * scale);
            doc.save();
            doc.dash(4, { space: 2 });
            doc.roundedRect(tx, ty, tw, th, cornerRadius).fillAndStroke('#f1f5f9', '#64748b');
            doc.undash();
            doc.restore();

            doc
              .fontSize(Math.max(7, Math.min(10, 10 * scale)))
              .font('Helvetica-Bold')
              .fillColor('#1e293b')
              .text(table.name, tx + 2, ty + th / 2 - 8, {
                width: tw - 4,
                align: 'center',
              });

            doc
              .fontSize(Math.max(6, Math.min(8, 8 * scale)))
              .font('Helvetica')
              .fillColor('#475569')
              .text(getSeatingShapeLabel(table.shape), tx + 2, ty + th / 2 + 3, {
                width: tw - 4,
                align: 'center',
              });
            return;
          }

          const isRound = shapeLower === 'round';
          const assignedCount = getGuestsHeadcount(table.invitationCodes || []);
          const isOverCapacity = assignedCount > table.capacity;

          const fillColor = isOverCapacity ? '#fef2f2' : '#ffffff';
          const strokeColor = isOverCapacity ? '#ef4444' : '#475569';

          // Resolve explicit, clamped, and companion seat assignments with dietary metadata
          const seatMap = resolveDetailedSeatAssignments(table.invitationCodes, table.capacity);

          if (isRound) {
            const radius = Math.min(tw, th) / 2;
            const cx = tx + tw / 2;
            const cy = ty + th / 2;

            doc.circle(cx, cy, radius).fillAndStroke(fillColor, strokeColor);

            doc
              .fontSize(Math.max(7, Math.min(10, 10 * scale)))
              .font('Helvetica-Bold')
              .fillColor('#0f172a')
              .text(table.name, cx - radius + 2, cy - 8, {
                width: radius * 2 - 4,
                align: 'center',
              });

            doc
              .fontSize(Math.max(6, Math.min(8, 8 * scale)))
              .font('Helvetica')
              .fillColor(isOverCapacity ? '#dc2626' : '#64748b')
              .text(`${assignedCount}/${table.capacity} seats`, cx - radius + 2, cy + 3, {
                width: radius * 2 - 4,
                align: 'center',
              });

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

              const seatEntry = seatMap.get(i);
              if (seatEntry) {
                const hasDietary = seatEntry.dietaryBadges.length > 0;
                doc
                  .circle(sx, sy, seatDotRadius)
                  .fillAndStroke(
                    hasDietary ? '#047857' : '#0284c7',
                    hasDietary ? '#065f46' : '#0369a1'
                  );
              } else {
                doc.circle(sx, sy, seatDotRadius).fillAndStroke('#ffffff', '#94a3b8');
              }
            }
          } else {
            doc
              .roundedRect(tx, ty, tw, th, Math.max(3, 6 * scale))
              .fillAndStroke(fillColor, strokeColor);

            doc
              .fontSize(Math.max(7, Math.min(10, 10 * scale)))
              .font('Helvetica-Bold')
              .fillColor('#0f172a')
              .text(table.name, tx + 2, ty + th / 2 - 8, {
                width: tw - 4,
                align: 'center',
              });

            doc
              .fontSize(Math.max(6, Math.min(8, 8 * scale)))
              .font('Helvetica')
              .fillColor(isOverCapacity ? '#dc2626' : '#64748b')
              .text(`${assignedCount}/${table.capacity} seats`, tx + 2, ty + th / 2 + 3, {
                width: tw - 4,
                align: 'center',
              });

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

              const seatEntry = seatMap.get(i);
              if (seatEntry) {
                const hasDietary = seatEntry.dietaryBadges.length > 0;
                doc
                  .circle(sx, sy, seatDotRadius)
                  .fillAndStroke(
                    hasDietary ? '#047857' : '#0284c7',
                    hasDietary ? '#065f46' : '#0369a1'
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

      doc.circle(margin + 50, legendY + 3, 4).fillAndStroke('#0284c7', '#0369a1');
      doc.fontSize(8).font('Helvetica').fillColor('#334155').text('Assigned Seat', margin + 58, legendY);

      doc.circle(margin + 135, legendY + 3, 4).fillAndStroke('#ffffff', '#94a3b8');
      doc.fontSize(8).font('Helvetica').fillColor('#334155').text('Available Seat', margin + 143, legendY);

      doc.rect(margin + 220, legendY, 12, 8).fillAndStroke('#fef2f2', '#ef4444');
      doc.fontSize(8).font('Helvetica').fillColor('#334155').text('Over Capacity Warning', margin + 236, legendY);

      doc.circle(margin + 355, legendY + 3, 4).fillAndStroke('#047857', '#065f46');
      doc.fontSize(8).font('Helvetica').fillColor('#334155').text('Dietary Restriction', margin + 363, legendY);

      if (landmarkTables.length > 0) {
        doc.rect(margin + 455, legendY, 12, 8).fillAndStroke('#f1f5f9', '#64748b');
        doc.fontSize(8).font('Helvetica').fillColor('#334155').text('Landmark', margin + 471, legendY);
      }

      // ==========================================
      // PAGE 2+: CATERER TABLE & ENTRÉE ROSTERS
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

      doc
        .fontSize(16)
        .font('Helvetica-Bold')
        .fillColor('#0f172a')
        .text('Table Seating & Caterer Entrée Rosters', margin, currentY);
      currentY += 24;

      if (guestTables.length === 0 && unassignedGuests.length === 0) {
        doc
          .fontSize(10)
          .font('Helvetica-Oblique')
          .fillColor('#64748b')
          .text('No guest tables or guest records found.', margin, currentY);
      } else {
        const colSeatW = 55;
        const colNameW = 185;
        const colMealW = 145;
        const colDietW = 155;

        for (const table of guestTables) {
          const guests = table.invitationCodes || [];
          const seatedHeadcount = getGuestsHeadcount(guests);
          const mealSummary = computeTableMealCounts(guests);
          const orderedEntries = Array.from(
            resolveDetailedSeatAssignments(guests, table.capacity).values()
          ).sort((a, b) => a.seatNumber - b.seatNumber);
          const rowCount = Math.max(1, orderedEntries.length);
          const tableBlockHeight = 22 + 18 + 18 + rowCount * 18 + 12;

          checkPageBreak(Math.min(tableBlockHeight, 170));

          // Table Banner Header
          doc.rect(margin, currentY, contentWidth, 22).fillAndStroke('#0f172a', '#0f172a');
          const shapeLabel = (table.shape || 'round').toUpperCase();
          const tableHeaderText = `${table.name}   (${shapeLabel}  |  Capacity: ${table.capacity}  |  Seated: ${seatedHeadcount})`;
          doc
            .fontSize(10)
            .font('Helvetica-Bold')
            .fillColor('#ffffff')
            .text(tableHeaderText, margin + 8, currentY + 6);
          currentY += 22;

          // Per-Table Entrée & Dietary Totals Row
          doc.rect(margin, currentY, contentWidth, 18).fillAndStroke('#f1f5f9', '#cbd5e1');
          doc.fontSize(8).font('Helvetica-Bold').fillColor('#1e293b');
          doc.text(
            `Entrée Counts: ${mealSummary.formattedMeals}   |   Dietary: ${mealSummary.formattedDietary}`,
            margin + 6,
            currentY + 5,
            { width: contentWidth - 12 }
          );
          currentY += 18;

          // Column Header Row (No Invitation Code!)
          doc.rect(margin, currentY, contentWidth, 18).fillAndStroke('#e2e8f0', '#cbd5e1');
          doc.fontSize(8).font('Helvetica-Bold').fillColor('#334155');
          doc.text('Seat #', margin + 6, currentY + 5, { width: colSeatW });
          doc.text('Attendee Name', margin + colSeatW + 6, currentY + 5, { width: colNameW });
          doc.text('Entrée Selection', margin + colSeatW + colNameW + 6, currentY + 5, {
            width: colMealW,
          });
          doc.text(
            'Dietary / Special Notes',
            margin + colSeatW + colNameW + colMealW + 6,
            currentY + 5,
            { width: colDietW }
          );
          currentY += 18;

          // Guest & Companion Seat Rows
          if (orderedEntries.length === 0) {
            doc.rect(margin, currentY, contentWidth, 18).fillAndStroke('#ffffff', '#e2e8f0');
            doc.fontSize(8).font('Helvetica-Oblique').fillColor('#94a3b8');
            doc.text('(No guests assigned to this table)', margin + 6, currentY + 5);
            currentY += 18;
          } else {
            for (let idx = 0; idx < orderedEntries.length; idx++) {
              const entry = orderedEntries[idx];
              const badgePrefix =
                entry.dietaryBadges.length > 0
                  ? `[${entry.dietaryBadges.map((b) => b.shortLabel).join(', ')}]`
                  : '';

              let dietaryText = badgePrefix || '—';
              if (!entry.isCompanion) {
                const mealSelections = formatGuestMealSelections(entry.guest);
                const customAnswers = formatGuestCustomAnswers(entry.guest);
                const primaryBadges = getDietaryBadges(
                  entry.guest.dietaryNotes,
                  entry.guest.extraFields,
                  entry.guest.partyTags
                );
                const effectiveBadges =
                  primaryBadges.length >= entry.dietaryBadges.length
                    ? primaryBadges
                    : entry.dietaryBadges;
                const dietaryPrefix =
                  effectiveBadges.length > 0
                    ? `[${effectiveBadges.map((b) => b.shortLabel).join(', ')}]`
                    : '';
                const baseDietLine = entry.guest.dietaryNotes
                  ? `${dietaryPrefix ? `${dietaryPrefix} ` : ''}${entry.guest.dietaryNotes}`
                  : dietaryPrefix;
                const detailLines = [
                  baseDietLine,
                  mealSelections ? `Meals: ${mealSelections}` : '',
                  customAnswers ? `Responses: ${customAnswers}` : '',
                ].filter(Boolean);
                dietaryText = detailLines.length > 0 ? detailLines.join('\n') : '—';
              }

              doc.fontSize(8).font('Helvetica');
              const nameTextH = doc.heightOfString(entry.displayName, { width: colNameW - 6 });
              const mealTextH = doc.heightOfString(entry.mealChoice || '—', { width: colMealW - 6 });
              const dietTextH = doc.heightOfString(dietaryText, { width: colDietW - 6 });
              const rowHeight = Math.max(
                18,
                Math.ceil(Math.max(nameTextH, mealTextH, dietTextH)) + 8
              );

              checkPageBreak(rowHeight + 2);

              const bg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
              doc.rect(margin, currentY, contentWidth, rowHeight).fillAndStroke(bg, '#e2e8f0');

              doc.fontSize(8).font('Helvetica').fillColor('#1e293b');
              doc.text(`Seat ${entry.seatNumber}`, margin + 6, currentY + 5, { width: colSeatW - 6 });
              doc.text(entry.displayName, margin + colSeatW + 6, currentY + 5, {
                width: colNameW - 6,
              });
              doc.text(entry.mealChoice || '—', margin + colSeatW + colNameW + 6, currentY + 5, {
                width: colMealW - 6,
              });
              doc.text(
                dietaryText,
                margin + colSeatW + colNameW + colMealW + 6,
                currentY + 5,
                { width: colDietW - 6 }
              );

              currentY += rowHeight;
            }
          }

          currentY += 12;
        }

        // Unassigned Guests Section (without Invitation Codes)
        if (unassignedGuests.length > 0) {
          checkPageBreak(60);

          doc.rect(margin, currentY, contentWidth, 22).fillAndStroke('#475569', '#475569');
          doc
            .fontSize(10)
            .font('Helvetica-Bold')
            .fillColor('#ffffff')
            .text(`Unassigned Guests (${unassignedCount})`, margin + 8, currentY + 6);
          currentY += 22;

          doc.rect(margin, currentY, contentWidth, 18).fillAndStroke('#e2e8f0', '#cbd5e1');
          doc.fontSize(8).font('Helvetica-Bold').fillColor('#334155');
          doc.text('Guest & Party Members', margin + 6, currentY + 5, {
            width: colNameW + colSeatW,
          });
          doc.text('Entrée Selections', margin + colSeatW + colNameW + 6, currentY + 5, {
            width: colMealW,
          });
          doc.text(
            'Dietary / Special Notes',
            margin + colSeatW + colNameW + colMealW + 6,
            currentY + 5,
            { width: colDietW }
          );
          currentY += 18;

          for (let idx = 0; idx < unassignedGuests.length; idx++) {
            const guest = unassignedGuests[idx];
            const companions = getGuestCompanionNames(guest);
            const guestDisplay =
              companions.length > 0
                ? `${guest.guestName} (+${companions.length}: ${companions.join(', ')})`
                : guest.guestName;

            const partyMembers = getInvitationPartyMembers(guest);
            const mealLabels = partyMembers
              .map((m) => m.mealChoice)
              .filter((m): m is string => Boolean(m));
            const mealColumnText = mealLabels.length > 0 ? mealLabels.join('; ') : '—';

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
            const unassignedMealH = doc.heightOfString(mealColumnText, {
              width: colMealW - 6,
            });
            const unassignedDietH = doc.heightOfString(unassignedDietText, {
              width: colDietW - 6,
            });
            const unassignedRowHeight = Math.max(
              18,
              Math.ceil(Math.max(unassignedNameH, unassignedMealH, unassignedDietH)) + 8
            );

            checkPageBreak(unassignedRowHeight + 2);

            const bg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
            doc
              .rect(margin, currentY, contentWidth, unassignedRowHeight)
              .fillAndStroke(bg, '#e2e8f0');

            doc.fontSize(8).font('Helvetica').fillColor('#1e293b');
            doc.text(guestDisplay, margin + 6, currentY + 5, { width: colNameW + colSeatW - 6 });
            doc.text(
              mealColumnText,
              margin + colSeatW + colNameW + 6,
              currentY + 5,
              { width: colMealW - 6 }
            );
            doc.text(
              unassignedDietText,
              margin + colSeatW + colNameW + colMealW + 6,
              currentY + 5,
              { width: colDietW - 6 }
            );

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
        doc
          .moveTo(margin, pageHeight - margin)
          .lineTo(pageWidth - margin, pageHeight - margin)
          .stroke('#cbd5e1');

        doc.fontSize(8).font('Helvetica').fillColor('#64748b');
        doc.text(`Page ${i + 1} of ${range.count}`, margin, pageHeight - margin + 6, {
          align: 'right',
          width: contentWidth,
        });

        doc.text(
          `${siteTitle} — Caterer & Venue Seating Plan`,
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

/**
 * Generates printable Avery tent place cards (`place-cards`, 8 per US Letter sheet) or
 * flat alphabetical escort cards (`escort-cards`, 10 per US Letter sheet) with guest names,
 * table/seat assignments, meal indicators, dietary badges, and a final caterer per-table
 * entrée summary page. Secret invitation codes (`guest.code`) are never included.
 */
export async function generateAveryCardsPdf(
  tables: SeatingTableDTO[],
  mode: AveryCardMode,
  options: GeneratePdfOptions = {}
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const titleSuffix = mode === 'place-cards' ? 'Avery Place Cards' : 'Avery Escort Cards';
      const doc = new PDFDocument({
        size: 'LETTER', // 612 x 792 points
        margin: 36,
        bufferPages: true,
        compress: false,
        info: {
          Title: options.siteTitle ? `${options.siteTitle} - ${titleSuffix}` : titleSuffix,
          Author: 'Wedding Website System',
          Subject: `Printable ${titleSuffix} & Caterer Meal Indicators`,
        },
      });

      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', (err: Error) => reject(err));

      const pageWidth = 612;
      const pageHeight = 792;
      const margin = 36;
      const contentWidth = pageWidth - margin * 2;

      const guestTables = tables.filter((t) => !isLandmarkTable(t));
      const cards: AveryCardEntry[] = [];

      for (const table of guestTables) {
        const detailed = resolveDetailedSeatAssignments(table.invitationCodes, table.capacity);
        const ordered = Array.from(detailed.values()).sort((a, b) => a.seatNumber - b.seatNumber);
        for (const entry of ordered) {
          cards.push({
            attendeeName: entry.attendeeName,
            tableName: table.name,
            seatNumber: entry.seatNumber,
            mealChoice: entry.mealChoice,
            dietaryBadges: entry.dietaryBadges,
            isPlusOne: entry.isPlusOne,
          });
        }
      }

      if (mode === 'escort-cards') {
        cards.sort(
          (a, b) =>
            a.attendeeName.localeCompare(b.attendeeName) ||
            a.tableName.localeCompare(b.tableName) ||
            a.seatNumber - b.seatNumber
        );
      }

      const cols = 2;
      const rows = mode === 'place-cards' ? 4 : 5;
      const cardsPerPage = cols * rows;
      const cardWidth = 252; // 3.5 inches
      const cardHeight = mode === 'place-cards' ? 162 : 132;
      const startX = (pageWidth - cols * cardWidth) / 2;
      const startY = (pageHeight - rows * cardHeight) / 2;

      if (cards.length > 0) {
        cards.forEach((card, index) => {
          if (index > 0 && index % cardsPerPage === 0) {
            doc.addPage();
          }

          const slot = index % cardsPerPage;
          const col = slot % cols;
          const row = Math.floor(slot / cols);
          const x = startX + col * cardWidth;
          const y = startY + row * cardHeight;

          // Outer trim border
          doc.rect(x, y, cardWidth, cardHeight).stroke('#cbd5e1');

          const faceTop = mode === 'place-cards' ? y + cardHeight / 2 : y;
          const faceHeight = mode === 'place-cards' ? cardHeight / 2 : cardHeight;

          if (mode === 'place-cards') {
            doc.save();
            doc.dash(3, { space: 3 });
            doc
              .moveTo(x + 8, faceTop)
              .lineTo(x + cardWidth - 8, faceTop)
              .stroke('#94a3b8');
            doc.undash();
            doc.restore();
          }

          // Attendee Name
          doc
            .fontSize(13)
            .font('Helvetica-Bold')
            .fillColor('#0f172a')
            .text(card.attendeeName, x + 12, faceTop + faceHeight * 0.22, {
              width: cardWidth - 24,
              align: 'center',
            });

          // Table & Seat Assignment
          const seatLine =
            mode === 'place-cards'
              ? `${card.tableName}  •  Seat ${card.seatNumber}`
              : `${card.tableName} (Seat ${card.seatNumber})`;
          doc
            .fontSize(10)
            .font('Helvetica')
            .fillColor('#334155')
            .text(seatLine, x + 12, faceTop + faceHeight * 0.5, {
              width: cardWidth - 24,
              align: 'center',
            });

          // Meal Indicator & Dietary Badges
          const indicators: string[] = [];
          if (card.mealChoice) {
            indicators.push(`Entrée: ${card.mealChoice}`);
          }
          if (card.dietaryBadges.length > 0) {
            indicators.push(`[${card.dietaryBadges.map((b) => b.shortLabel).join(', ')}]`);
          }
          if (indicators.length > 0) {
            doc
              .fontSize(8)
              .font('Helvetica-Bold')
              .fillColor('#047857')
              .text(indicators.join('  '), x + 12, faceTop + faceHeight * 0.72, {
                width: cardWidth - 24,
                align: 'center',
              });
          }
        });

        doc.addPage();
      }

      // Final Summary Sheet: Caterer Entrée Counts per Table
      let summaryY = margin;
      doc
        .fontSize(15)
        .font('Helvetica-Bold')
        .fillColor('#0f172a')
        .text(`${titleSuffix} — Caterer Entrée Counts per Table`, margin, summaryY);
      summaryY += 22;

      doc
        .fontSize(9)
        .font('Helvetica')
        .fillColor('#64748b')
        .text(
          `Total Printable Cards: ${cards.length} across ${guestTables.length} guest table${guestTables.length === 1 ? '' : 's'}`,
          margin,
          summaryY
        );
      summaryY += 20;

      if (guestTables.length === 0) {
        doc
          .fontSize(10)
          .font('Helvetica-Oblique')
          .fillColor('#64748b')
          .text('No guest tables configured yet.', margin, summaryY);
      } else {
        for (const table of guestTables) {
          if (summaryY + 34 > pageHeight - margin) {
            doc.addPage();
            summaryY = margin;
          }
          const occupied = getGuestsHeadcount(table.invitationCodes);
          const summary = computeTableMealCounts(table.invitationCodes);
          doc.rect(margin, summaryY, contentWidth, 26).fillAndStroke('#f8fafc', '#cbd5e1');
          doc
            .fontSize(9)
            .font('Helvetica-Bold')
            .fillColor('#0f172a')
            .text(
              `${table.name} (${occupied}/${table.capacity} seats) — Entrées: ${summary.formattedMeals} | Dietary: ${summary.formattedDietary}`,
              margin + 8,
              summaryY + 8,
              { width: contentWidth - 16 }
            );
          summaryY += 32;
        }
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
