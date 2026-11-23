import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { axe, toHaveNoViolations } from 'jest-axe';
import {
  UploadAlert,
  type UploadAlertProps,
  UploadStatusNotice,
  type UploadStatusNoticeProps,
  UploadProgressBar,
  type UploadProgressBarProps,
} from '../UploadStatus';

expect.extend(toHaveNoViolations);

describe('UploadStatus primitives', () => {
  test('UploadAlert renders role="alert", forwards ref, merges className, and passes jest-axe', async () => {
    const alertRef = React.createRef<HTMLParagraphElement>();
    const alertProps: UploadAlertProps = {
      showIcon: true,
      className: 'custom-alert',
    };

    const { container } = render(
      <UploadAlert ref={alertRef} {...alertProps}>
        File exceeds size limit
      </UploadAlert>
    );

    const alert = screen.getByRole('alert');
    expect(alertRef.current).toBeInstanceOf(HTMLParagraphElement);
    expect(alert).toHaveTextContent('File exceeds size limit');
    expect(alert).toHaveClass('custom-alert');
    expect(alert.querySelector('svg[aria-hidden="true"]')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  test('UploadStatusNotice renders polite role="status", forwards ref, and passes jest-axe', async () => {
    const noticeRef = React.createRef<HTMLDivElement>();
    const noticeProps: UploadStatusNoticeProps = {
      showIcon: true,
      className: 'custom-notice',
    };

    const { container } = render(
      <UploadStatusNotice ref={noticeRef} {...noticeProps}>
        Uploaded and awaiting review
      </UploadStatusNotice>
    );

    const notice = screen.getByRole('status');
    expect(noticeRef.current).toBeInstanceOf(HTMLDivElement);
    expect(notice).toHaveAttribute('aria-live', 'polite');
    expect(notice).toHaveTextContent('Uploaded and awaiting review');
    expect(notice).toHaveClass('custom-notice');
    expect(await axe(container)).toHaveNoViolations();
  });

  test('UploadProgressBar exposes role="progressbar" with clamped aria-valuenow and filename aria-label', async () => {
    const barRef = React.createRef<HTMLDivElement>();
    const barProps: UploadProgressBarProps = {
      value: 64.6,
      filename: 'ceremony.jpg',
      className: 'custom-progress',
    };

    const { container, rerender } = render(<UploadProgressBar ref={barRef} {...barProps} />);

    let progressbar = screen.getByRole('progressbar', { name: 'Uploading ceremony.jpg' });
    expect(barRef.current).toBeInstanceOf(HTMLDivElement);
    expect(progressbar).toHaveAttribute('aria-valuemin', '0');
    expect(progressbar).toHaveAttribute('aria-valuemax', '100');
    expect(progressbar).toHaveAttribute('aria-valuenow', '65');
    expect(progressbar).toHaveClass('custom-progress');
    expect(await axe(container)).toHaveNoViolations();

    rerender(<UploadProgressBar value={150} filename="ceremony.jpg" />);
    progressbar = screen.getByRole('progressbar', { name: 'Uploading ceremony.jpg' });
    expect(progressbar).toHaveAttribute('aria-valuenow', '100');

    rerender(<UploadProgressBar value={-15} filename="ceremony.jpg" />);
    progressbar = screen.getByRole('progressbar', { name: 'Uploading ceremony.jpg' });
    expect(progressbar).toHaveAttribute('aria-valuenow', '0');
  });
});
