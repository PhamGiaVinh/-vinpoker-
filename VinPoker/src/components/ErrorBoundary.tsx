import { Component, ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: any) {
    console.error("ErrorBoundary caught:", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="max-w-xl mx-auto mt-10 p-6 rounded-lg border border-destructive/40 bg-card text-center space-y-3">
          <h2 className="font-display text-xl text-destructive">Something went wrong</h2>
          <p className="text-sm text-muted-foreground break-words">{this.state.error.message}</p>
          <button
            onClick={() => { this.setState({ error: null }); window.location.reload(); }}
            className="text-sm text-primary underline"
          >
            Reload page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
