import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { axe, toHaveNoViolations } from 'jest-axe';
import {
  ToggleButtonGroup,
  type ToggleButtonGroupProps,
  type ToggleButtonOption,
} from '../ToggleButtonGroup';

expect.extend(toHaveNoViolations);

describe('ToggleButtonGroup', () => {
  const rsvpOptions: ToggleButtonOption<'attending' | 'declined' | 'pending'>[] = [
    { value: 'attending', label: 'Attending' },
    { value: 'declined', label: 'Declined' },
    { value: 'pending', label: 'Pending' },
  ];

  function ControlledRadioGroup(
    props: Partial<ToggleButtonGroupProps<'attending' | 'declined' | 'pending'>> & {
      initialValue?: 'attending' | 'declined' | 'pending';
    }
  ) {
    const [val, setVal] = useState<'attending' | 'declined' | 'pending'>(
      props.initialValue ?? 'attending'
    );
    return (
      <div>
        <span id="rsvp-label">Your RSVP for Ceremony</span>
        <ToggleButtonGroup
          mode="radiogroup"
          aria-labelledby="rsvp-label"
          value={val}
          onChange={setVal}
          options={props.options ?? rsvpOptions}
        />
      </div>
    );
  }

  it('renders radiogroup mode with aria-labelledby, radio roles, aria-checked, and non-color check icon', async () => {
    const { container } = render(<ControlledRadioGroup />);

    const group = screen.getByRole('radiogroup', { name: 'Your RSVP for Ceremony' });
    expect(group).toBeInTheDocument();

    const attending = screen.getByRole('radio', { name: 'Attending' });
    const declined = screen.getByRole('radio', { name: 'Declined' });
    const pending = screen.getByRole('radio', { name: 'Pending' });

    expect(attending).toHaveAttribute('aria-checked', 'true');
    expect(declined).toHaveAttribute('aria-checked', 'false');
    expect(pending).toHaveAttribute('aria-checked', 'false');

    // Active radio renders non-color SVG checkmark indicator and ring class
    expect(attending.querySelector('svg[aria-hidden="true"]')).toBeInTheDocument();
    expect(declined.querySelector('svg[aria-hidden="true"]')).toBeNull();

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('supports roving tabIndex and Arrow, Home, and End navigation in radiogroup mode', () => {
    render(<ControlledRadioGroup />);

    const attending = screen.getByRole('radio', { name: 'Attending' });
    const declined = screen.getByRole('radio', { name: 'Declined' });
    const pending = screen.getByRole('radio', { name: 'Pending' });

    expect(attending).toHaveAttribute('tabIndex', '0');
    expect(declined).toHaveAttribute('tabIndex', '-1');
    expect(pending).toHaveAttribute('tabIndex', '-1');

    attending.focus();

    // ArrowRight -> Declined
    fireEvent.keyDown(attending, { key: 'ArrowRight' });
    expect(declined).toHaveFocus();
    expect(declined).toHaveAttribute('aria-checked', 'true');
    expect(declined).toHaveAttribute('tabIndex', '0');
    expect(attending).toHaveAttribute('tabIndex', '-1');

    // ArrowDown -> Pending
    fireEvent.keyDown(declined, { key: 'ArrowDown' });
    expect(pending).toHaveFocus();
    expect(pending).toHaveAttribute('aria-checked', 'true');

    // ArrowRight wraps -> Attending
    fireEvent.keyDown(pending, { key: 'ArrowRight' });
    expect(attending).toHaveFocus();
    expect(attending).toHaveAttribute('aria-checked', 'true');

    // ArrowLeft wraps -> Pending
    fireEvent.keyDown(attending, { key: 'ArrowLeft' });
    expect(pending).toHaveFocus();
    expect(pending).toHaveAttribute('aria-checked', 'true');

    // ArrowUp -> Declined
    fireEvent.keyDown(pending, { key: 'ArrowUp' });
    expect(declined).toHaveFocus();
    expect(declined).toHaveAttribute('aria-checked', 'true');

    // Home -> Attending
    fireEvent.keyDown(declined, { key: 'Home' });
    expect(attending).toHaveFocus();
    expect(attending).toHaveAttribute('aria-checked', 'true');

    // End -> Pending
    fireEvent.keyDown(attending, { key: 'End' });
    expect(pending).toHaveFocus();
    expect(pending).toHaveAttribute('aria-checked', 'true');
  });

  it('skips disabled options during keyboard navigation', () => {
    render(
      <ControlledRadioGroup
        options={[
          { value: 'attending', label: 'Attending' },
          { value: 'declined', label: 'Declined', disabled: true },
          { value: 'pending', label: 'Pending' },
        ]}
      />
    );

    const attending = screen.getByRole('radio', { name: 'Attending' });
    const declined = screen.getByRole('radio', { name: 'Declined' });
    const pending = screen.getByRole('radio', { name: 'Pending' });

    expect(declined).toBeDisabled();
    attending.focus();
    fireEvent.keyDown(attending, { key: 'ArrowRight' });
    expect(pending).toHaveFocus();
    expect(pending).toHaveAttribute('aria-checked', 'true');
  });

  it('renders group mode with aria-pressed states, roving tabIndex, and multi-select support', async () => {
    function MultiToggleDemo() {
      const [selected, setSelected] = useState<string[]>(['vip']);
      return (
        <ToggleButtonGroup
          mode="group"
          multiple
          aria-label="Filter by party tags"
          value={selected}
          onChange={setSelected}
          options={[
            { value: 'vip', label: '#VIP' },
            { value: 'family', label: '#Family' },
            { value: 'bridal', label: '#Bridal' },
          ]}
        />
      );
    }

    const { container } = render(<MultiToggleDemo />);
    const group = screen.getByRole('group', { name: 'Filter by party tags' });
    expect(group).toBeInTheDocument();

    const vipBtn = screen.getByRole('button', { name: '#VIP' });
    const familyBtn = screen.getByRole('button', { name: '#Family' });
    const bridalBtn = screen.getByRole('button', { name: '#Bridal' });

    expect(vipBtn).toHaveAttribute('aria-pressed', 'true');
    expect(familyBtn).toHaveAttribute('aria-pressed', 'false');
    expect(bridalBtn).toHaveAttribute('aria-pressed', 'false');

    // Arrow navigation moves roving focus without unintentionally toggling pressed state
    vipBtn.focus();
    fireEvent.keyDown(vipBtn, { key: 'ArrowRight' });
    expect(familyBtn).toHaveFocus();
    expect(familyBtn).toHaveAttribute('tabIndex', '0');
    expect(familyBtn).toHaveAttribute('aria-pressed', 'false');

    // Clicking toggles #Family on while keeping #VIP pressed
    fireEvent.click(familyBtn);
    expect(familyBtn).toHaveAttribute('aria-pressed', 'true');
    expect(vipBtn).toHaveAttribute('aria-pressed', 'true');

    // Clicking #VIP toggles it off
    fireEvent.click(vipBtn);
    expect(vipBtn).toHaveAttribute('aria-pressed', 'false');

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('supports card options with descriptions and forwards ref', () => {
    const ref = React.createRef<HTMLDivElement>();
    const onChange = jest.fn();

    render(
      <ToggleButtonGroup
        ref={ref}
        mode="radiogroup"
        aria-label="Starter presets"
        value="classic"
        onChange={onChange}
        options={[
          { value: 'classic', label: 'Classic', description: 'Formal seated dinner' },
          { value: 'modern', label: 'Modern', description: 'Cocktail style' },
        ]}
      />
    );

    expect(ref.current).toBeInstanceOf(HTMLDivElement);
    const classicRadio = screen.getByRole('radio', { name: /Classic/i });
    expect(classicRadio).toHaveClass('border-primary');
    expect(classicRadio.querySelector('svg[aria-hidden="true"]')).toBeInTheDocument();
  });
});
