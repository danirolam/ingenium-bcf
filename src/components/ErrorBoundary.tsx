import { Component, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  reset = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            padding: "48px 32px",
            maxWidth: 720,
            margin: "60px auto",
            fontFamily: "var(--sans)",
            color: "var(--ink)",
          }}
        >
          <div
            style={{
              fontSize: 13,
              color: "var(--ink-3)",
              marginBottom: 12,
            }}
          >
            Something went wrong
          </div>
          <h1
            style={{
              fontSize: 28,
              fontWeight: 600,
              letterSpacing: "-0.03em",
              margin: "0 0 16px",
            }}
          >
            The workspace hit an error and stopped rendering.
          </h1>
          <pre
            style={{
              background: "var(--panel-2)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: 14,
              fontSize: 12.5,
              color: "var(--ink-2)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              margin: "0 0 20px",
            }}
          >
            {this.state.error.message}
          </pre>
          <div style={{ display: "flex", gap: 10 }}>
            <button
              type="button"
              className="btn primary"
              onClick={this.reset}
            >
              Try again
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                if (typeof window !== "undefined") {
                  window.location.assign("/");
                }
              }}
            >
              Reload landing
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
