import fs from 'fs';
import path from 'path';

describe('Secondary Button Hover Style Contrast Validation', () => {
  it('should have updated .btn-secondary in globals.css to use a dynamic 10% opacity primary color background on hover', () => {
    const cssPath = path.join(process.cwd(), 'src/app/globals.css');
    const cssContent = fs.readFileSync(cssPath, 'utf8');

    // Ensure the static hover background color is removed from .btn-secondary
    const btnSecondaryMatch = cssContent.match(/\.btn-secondary\s*{([^}]+)}/);
    expect(btnSecondaryMatch).toBeTruthy();
    
    const btnSecondaryStyles = btnSecondaryMatch![1];
    expect(btnSecondaryStyles).not.toContain('hover:bg-primary-light');
    
    // Ensure the .btn-secondary:hover class is present and configured with color-mix
    const hoverMatch = cssContent.match(/\.btn-secondary:hover\s*{([^}]+)}/);
    expect(hoverMatch).toBeTruthy();

    const hoverStyles = hoverMatch![1].trim();
    expect(hoverStyles).toContain('background-color:');
    expect(hoverStyles).toContain('color-mix(in srgb, var(--color-primary) 10%, transparent)');
  });
});
