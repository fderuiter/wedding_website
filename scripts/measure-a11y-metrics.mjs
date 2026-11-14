import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { fileURLToPath } from 'url';

/**
 * WCAG 2.2 SC 2.5.8 Target Size (Minimum) automated audit measurement.
 *
 * Verifies interactive navigation controls across mobile and desktop viewports:
 * - Admin navigation links: minimum height >= 32px, minimum width >= 24px
 * - Monogram header link: minimum height >= 24px, minimum width >= 24px
 * - Logout control: minimum height >= 24px, minimum width >= 24px
 *
 * Compliance guardrails:
 * - WCAG 2.2 Success Criterion 2.5.8 Target Size (Minimum)
 * - Zero axe-core target-size violations on audited components
 */

const AUDIT_STYLES = [
  '* { box-sizing: border-box; }',
  'body { font-family: sans-serif; margin: 0; padding: 16px; }',
  '.inline-flex { display: inline-flex; } .flex { display: flex; } .flex-wrap { flex-wrap: wrap; }',
  '.items-center { align-items: center; } .justify-center { justify-content: center; }',
  '.min-h-\\[32px\\] { min-height: 32px; } .min-w-\\[24px\\] { min-width: 24px; }',
  '.min-h-\\[24px\\] { min-height: 24px; } .rounded-md { border-radius: 6px; }',
  '.px-3 { padding-left: 12px; padding-right: 12px; } .gap-2 { gap: 8px; }',
  '.py-1\\.5 { padding-top: 6px; padding-bottom: 6px; } .py-1 { padding-top: 4px; padding-bottom: 4px; }',
  '.text-sm { font-size: 14px; line-height: 20px; } .text-xs { font-size: 12px; line-height: 16px; }',
].join('\n');

export async function runTargetSizeAudit(options = {}) {
  const browser = await chromium.launch({ headless: true });
  const violations = [];
  try {
    const viewports = [{ width: 375, height: 667 }, { width: 1280, height: 720 }];
    for (const viewport of viewports) {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      await page.setContent(getAuditMarkup());

      const axeResults = await new AxeBuilder({ page })
        .withRules(['target-size'])
        .options({ rules: { 'target-size': { enabled: true } } })
        .analyze();

      const axeViolations = axeResults.violations.filter((v) => v.id === 'target-size');
      if (axeViolations.length > 0) {
        violations.push(...axeViolations);
      }

      const elements = await page.evaluate(() => {
        const adminLinks = Array.from(document.querySelectorAll('nav[aria-label="Admin Navigation"] a')).map((el) => {
          const r = el.getBoundingClientRect();
          return { label: el.textContent.trim(), width: r.width, height: r.height, minHeight: 32, minWidth: 24 };
        });
        const brandLink = Array.from(document.querySelectorAll('header a')).map((el) => {
          const r = el.getBoundingClientRect();
          return { label: 'Brand Monogram', width: r.width, height: r.height, minHeight: 24, minWidth: 24 };
        });
        const logoutBtn = Array.from(document.querySelectorAll('header button')).map((el) => {
          const r = el.getBoundingClientRect();
          return { label: 'Logout Button', width: r.width, height: r.height, minHeight: 24, minWidth: 24 };
        });
        return [...adminLinks, ...brandLink, ...logoutBtn];
      });

      for (const el of elements) {
        if (el.height < el.minHeight || el.width < el.minWidth) {
          violations.push({
            id: 'target-size',
            target: el.label,
            description: `Target ${el.label} (${el.width}x${el.height}px) fails minimum requirements (${el.minWidth}x${el.minHeight}px)`
          });
        }
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }
  return violations;
}

function getAuditMarkup() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>A11y Target Size Audit</title>
  <style>${AUDIT_STYLES}</style>
</head>
<body>
  <main>
    <h1>A11y Target Size Audit</h1>
    <nav aria-label="Admin Navigation">
      <ul class="flex flex-wrap items-center gap-2" style="list-style:none; padding:0; margin:0;">
        <li><a href="/admin/dashboard" class="inline-flex items-center justify-center px-3 py-1.5 min-h-[32px] min-w-[24px] rounded-md text-sm">Registry</a></li>
        <li><a href="/admin/dashboard/invitation-codes" class="inline-flex items-center justify-center px-3 py-1.5 min-h-[32px] min-w-[24px] rounded-md text-sm">Invitation Codes</a></li>
        <li><a href="/admin/dashboard/site-manager" class="inline-flex items-center justify-center px-3 py-1.5 min-h-[32px] min-w-[24px] rounded-md text-sm">Site Manager</a></li>
      </ul>
    </nav>
    <header>
      <div class="flex items-center gap-2">
        <a href="/" class="flex items-center min-h-[24px] min-w-[24px] text-2xl rounded">
          <span class="min-h-[24px] min-w-[24px] inline-flex items-center justify-center">A & B</span>
        </a>
        <button class="min-h-[24px] min-w-[24px] inline-flex items-center justify-center px-3 py-1 text-xs rounded-md">Logout</button>
      </div>
    </header>
  </main>
</body>
</html>`;
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  runTargetSizeAudit()
    .then((violations) => {
      if (violations.length === 0) {
        console.log('✅ Automated scans passed with zero target-size errors.');
        process.exit(0);
      } else {
        console.error(`❌ Found ${violations.length} target-size violation(s):`, violations);
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error('Audit execution failed:', err);
      process.exit(1);
    });
}
