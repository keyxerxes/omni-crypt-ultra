import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(error: unknown): State {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : 'Unexpected runtime fault in worker pipeline.',
    };
  }

  handleReset = () => {
    this.setState({ hasError: false, message: '' });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#090A0D] text-[#ECEEF2] flex items-center justify-center p-6">
          <div className="max-w-lg w-full bg-[#111318] border border-[#EF4444]/40 rounded p-6 space-y-4">
            <div className="flex items-center gap-2.5 text-[#EF4444]">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <h2 className="text-sm font-mono font-semibold uppercase tracking-wide">
                RUNTIME FAULT INTERCEPTED
              </h2>
            </div>
            <p className="text-xs font-mono text-[#949BA8] bg-[#090A0D] border border-[#1E222B] p-3 rounded break-all">
              {this.state.message}
            </p>
            <button
              type="button"
              onClick={this.handleReset}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium bg-[#161922] hover:bg-[#1E222B] border border-[#2E3545] rounded text-[#ECEEF2] transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset Workspace Module
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
