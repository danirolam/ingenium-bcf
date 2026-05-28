import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

type AlertVariant =
  | "secondary"
  | "primary"
  | "destructive"
  | "success"
  | "info"
  | "mono"
  | "warning";
type AlertAppearance = "solid" | "outline" | "light" | "stroke";
type AlertSize = "sm" | "md" | "lg";
type AlertIconTone = "primary" | "destructive" | "success" | "info" | "warning";

interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: AlertVariant;
  appearance?: AlertAppearance;
  size?: AlertSize;
  icon?: AlertIconTone;
  close?: boolean;
  onClose?: () => void;
}

interface AlertIconProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: AlertIconTone;
}

function Alert({
  className,
  variant = "secondary",
  appearance = "solid",
  size = "md",
  icon,
  close = false,
  onClose,
  children,
  ...props
}: AlertProps) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(
        "alert-1",
        `alert-1-${variant}`,
        `alert-1-${appearance}`,
        `alert-1-${size}`,
        icon && `alert-1-icon-${icon}`,
        className,
      )}
      {...props}
    >
      {children}
      {close && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Dismiss"
          data-slot="alert-close"
          className="alert-1-close"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}

function AlertTitle({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="alert-title" className={cn("alert-1-title", className)} {...props} />;
}

function AlertIcon({ children, className, ...props }: AlertIconProps) {
  return (
    <div data-slot="alert-icon" className={cn("alert-1-icon", className)} {...props}>
      {children}
    </div>
  );
}

function AlertToolbar({ children, className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div data-slot="alert-toolbar" className={cn("alert-1-toolbar", className)} {...props}>
      {children}
    </div>
  );
}

function AlertDescription({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="alert-description"
      className={cn("alert-1-description", className)}
      {...props}
    />
  );
}

function AlertContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div data-slot="alert-content" className={cn("alert-1-content", className)} {...props} />
  );
}

export { Alert, AlertContent, AlertDescription, AlertIcon, AlertTitle, AlertToolbar };
