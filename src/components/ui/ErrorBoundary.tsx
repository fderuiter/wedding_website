'use client';

import { Component, ErrorInfo, ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';

export interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode | ((error: Error, reset: () => void) => ReactNode);
  title?: string;
  message?: string;
  onReset?: () => void;
  className?: string;
}

export interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * @class ErrorBoundary
 * @description Reusable component-level React Error Boundary that catches runtime errors
 * in its child component tree, preventing full-page crashes and providing localized UI fallbacks
 * with brand tokens and retry controls.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  public reset = () => {
    this.props.onReset?.();
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError && this.state.error) {
      if (typeof this.props.fallback === 'function') {
        return this.props.fallback(this.state.error, this.reset);
      }
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const title = this.props.title || 'Something went wrong';
      const message =
        this.props.message ||
        'An error occurred while displaying this section. You can try clicking below to reload it.';

      return (
        <div
          role="alert"
          aria-live="assertive"
          className={`p-6 md:p-8 rounded-2xl bg-white/10 dark:bg-gray-800/80 backdrop-blur-md border border-primary/30 text-center shadow-lg my-4 max-w-xl mx-auto flex flex-col items-center justify-center space-y-4 text-[var(--color-foreground)] ${
            this.props.className || ''
          }`}
        >
          <div className="p-3 rounded-full bg-primary/10 text-primary">
            <Icon name="AlertTriangle" className="w-8 h-8" />
          </div>
          <div>
            <h3 className="text-xl font-bold mb-1 text-primary">{title}</h3>
            <p className="text-sm opacity-90 mb-4">{message}</p>
          </div>
          <Button onClick={this.reset} variant="primary" size="md">
            Try Again
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}
