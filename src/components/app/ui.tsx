'use client';

import { cloneElement, isValidElement, forwardRef, useEffect, useId, useRef, type ReactNode, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import '@/styles/app.css';

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'accent';
export function cx(...values: (string | false | null | undefined)[]) { return values.filter(Boolean).join(' '); }

/** Small, consistent line icons; decorative by default, text carries meaning. */
export function Icon({ name = 'arrow', size = 20, className }: { name?: string; size?: number; className?: string }) {
  const paths: Record<string, ReactNode> = {
    arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
    back: <path d="M19 12H5m6-6-6 6 6 6" />,
    plus: <path d="M12 5v14M5 12h14" />,
    check: <path d="m5 12 4 4L19 6" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    menu: <path d="M4 6h16M4 12h16M4 18h16" />,
    plane: <><path d="m22 2-7 20-4-9-9-4 20-7Z" /><path d="m22 2-11 11" /></>,
    shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z" /><path d="m8 12 3 3 5-6" /></>,
    users: <><circle cx="9" cy="7" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6M17 14a5 5 0 0 1 4 5v2" /></>,
    user: <><circle cx="12" cy="7" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></>,
    home: <><path d="m3 10 9-7 9 7v11H3V10Z" /><path d="M9 21v-8h6v8" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M7 3v4M17 3v4M3 11h18M8 15h2M14 15h2" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    location: <><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></>,
    chat: <path d="M21 11a8 8 0 0 1-8 8H8l-5 3V11a9 9 0 1 1 18 0Z" />,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4" /></>,
    star: <path d="m12 3 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1 3-6Z" />,
    document: <><path d="M5 3h9l5 5v13H5V3Z" /><path d="M14 3v6h5M8 13h8M8 17h6" /></>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="3" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" /></>,
    alert: <><path d="m12 3 10 18H2L12 3Z" /><path d="M12 9v5M12 17h.01" /></>,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7h.01" /></>,
    edit: <><path d="m16 3 5 5-12 12-6 1 1-6L16 3Z" /><path d="m13 6 5 5" /></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M5 8a8 8 0 0 1 14-3l1 2M19 16a8 8 0 0 1-14 3l-1-2" /></>,
    logout: <><path d="M9 3H3v18h6M9 12h12m-5-5 5 5-5 5" /></>,
    heart: <path d="M12 21 3 12a6 6 0 0 1 9-8 6 6 0 0 1 9 8l-9 9Z" />,
    globe: <><circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="4" ry="9" /><path d="M3 12h18" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={cx('tb-icon', className)}>{paths[name] ?? paths.plane}</svg>;
}

export function PageHeader({ title, description, eyebrow = 'Your journey, thoughtfully connected', actions, backHref, backLabel = 'Back' }: { title: ReactNode; description?: ReactNode; eyebrow?: string; actions?: ReactNode; backHref?: string; backLabel?: string }) {
  return <header className="tb-page-header">{backHref && <a href={backHref} className="tb-back-link"><Icon name="back" size={16} />{backLabel}</a>}<div className="tb-page-header-row"><div className="tb-page-heading"><p className="tb-app-eyebrow">{eyebrow}</p><h1>{title}</h1>{description && <div className="tb-page-description">{description}</div>}</div>{actions && <div className="tb-actions">{actions}</div>}</div></header>;
}

export function SectionHeader({ title, description, actions, id, icon }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; id?: string; icon?: string }) {
  return <div className="tb-section-header"><div>{icon && <span className="tb-section-icon"><Icon name={icon} /></span>}<h2 id={id}>{title}</h2>{description && <p>{description}</p>}</div>{actions && <div className="tb-actions">{actions}</div>}</div>;
}

export function GlassCard({ children, className, tone = 'neutral', ...props }: HTMLAttributes<HTMLDivElement> & { tone?: Tone }) {
  return <div {...props} className={cx('tb-card', `tb-card-${tone}`, className)}>{children}</div>;
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { href?: string; icon?: string; loading?: boolean };
function Button({ children, className, href, icon, loading, disabled, type = 'button', ...props }: ButtonProps & { variant: string }) {
  const { variant, ...nativeProps } = props;
  const content = <>{loading ? <span className="tb-spinner tb-spinner-small" aria-hidden="true" /> : icon && <Icon name={icon} size={17} />}<span>{children}</span></>;
  const styles = cx('tb-button', `tb-button-${variant}`, className);
  if (href) return <a href={disabled || loading ? undefined : href} className={styles} aria-disabled={disabled || loading || undefined} aria-label={nativeProps['aria-label']} onClick={disabled || loading ? e => e.preventDefault() : undefined}>{content}</a>;
  return <button {...nativeProps} type={type} className={styles} disabled={disabled || loading} aria-busy={loading || undefined}>{content}</button>;
}
export function PrimaryButton(props: ButtonProps) { return <Button variant="primary" {...props} />; }
export function SecondaryButton(props: ButtonProps) { return <Button variant="secondary" {...props} />; }
export function DangerButton(props: ButtonProps) { return <Button variant="danger" {...props} />; }

function statusTone(status: string): Tone {
  if (/^(active|verified|passed|confirmed|completed|accepted|paid|resolved|succeeded)$/i.test(status)) return 'success';
  if (/^(rejected|failed|cancelled|cancelled_by_family|cancelled_by_companion|sos)$/i.test(status)) return 'danger';
  if (/^(pending|searching|expired|acknowledged|in_progress)$/i.test(status)) return 'warning';
  if (/^(booked|upcoming|matched|draft)$/i.test(status)) return 'info';
  return 'neutral';
}
export function StatusBadge({ status, children, tone, className }: { status?: string | null; children?: ReactNode; tone?: Tone; className?: string }) {
  const label = status || 'Not set';
  return <span className={cx('tb-badge', `tb-badge-${tone ?? statusTone(label)}`, className)}><span className="tb-badge-dot" aria-hidden="true" />{children ?? label.replaceAll('_', ' ')}</span>;
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) { return <input {...props} ref={ref} className={cx('tb-input', className)} />; });
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, ...props }, ref) { return <select {...props} ref={ref} className={cx('tb-input', 'tb-select', className)} />; });
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...props }, ref) { return <textarea {...props} ref={ref} className={cx('tb-input', 'tb-textarea', className)} />; });
export function FormField({ label, htmlFor, hint, error, required, children, className }: { label: ReactNode; htmlFor?: string; hint?: ReactNode; error?: ReactNode; required?: boolean; children: ReactNode; className?: string }) {
  const control = isValidElement<Record<string, unknown>>(children) ? cloneElement(children, {
    // Keep the accessible name equal to the meaningful label, not a decorative
    // required asterisk. Preserve explicit labels/descriptions on time controls.
    'aria-label': children.props['aria-label'] ?? (typeof label === 'string' ? label : undefined),
    'aria-describedby': children.props['aria-describedby'] ?? (htmlFor ? [hint && `${htmlFor}-hint`, error && `${htmlFor}-error`].filter(Boolean).join(' ') || undefined : undefined),
  }) : children;
  return <div className={cx('tb-field', className)}><label htmlFor={htmlFor}>{label}{required && <span aria-hidden="true" className="tb-required"> *</span>}</label>{control}{hint && <p className="tb-field-hint" id={htmlFor ? `${htmlFor}-hint` : undefined}>{hint}</p>}{error && <p role="alert" className="tb-field-error" id={htmlFor ? `${htmlFor}-error` : undefined}>{error}</p>}</div>;
}

export function Avatar({ name, size = 'medium', className }: { name: string; size?: 'small' | 'medium' | 'large'; className?: string }) {
  const initials = name.trim().split(/\s+/).slice(0,2).map(word => word[0]).join('').toUpperCase() || 'TB';
  return <span className={cx('tb-avatar', `tb-avatar-${size}`, className)} aria-hidden="true">{initials}</span>;
}
export function StatCard({ label, value, description, icon = 'plane', tone = 'info' }: { label: string; value: ReactNode; description?: ReactNode; icon?: string; tone?: Tone }) {
  return <GlassCard className="tb-stat-card"><div className="tb-stat-top"><span>{label}</span><span className={cx('tb-stat-icon', `tb-tone-${tone}`)}><Icon name={icon} size={19} /></span></div><div className="tb-stat-value">{value}</div>{description && <p className="tb-muted tb-small">{description}</p>}</GlassCard>;
}
export function ProfileCard({ name, subtitle, status, children, actions, className }: { name: string; subtitle?: ReactNode; status?: string; children?: ReactNode; actions?: ReactNode; className?: string }) {
  return <GlassCard className={cx('tb-profile-card', className)}><div className="tb-profile-card-heading"><Avatar name={name} /><div className="tb-min-zero"><h3>{name}</h3>{subtitle && <p className="tb-muted tb-small">{subtitle}</p>}</div>{status && <StatusBadge status={status} />}</div>{children}{actions && <div className="tb-profile-actions tb-actions">{actions}</div>}</GlassCard>;
}

export function EmptyState({ title = 'A fresh start for your next journey', description, message, action, icon = 'plane' }: { title?: ReactNode; description?: ReactNode; message?: ReactNode; action?: ReactNode; icon?: string }) {
  return <div className="tb-state tb-empty-state"><span className="tb-state-icon"><Icon name={icon} size={26} /></span><h3>{title}</h3>{(description || message) && <p>{description ?? message}</p>}{action && <div className="tb-actions">{action}</div>}</div>;
}
export function LoadingState({ label = 'Preparing your journey…', message }: { label?: string; message?: string }) {
  return <div className="tb-state" role="status" aria-live="polite"><span className="tb-spinner" aria-hidden="true" /><h3>{message ?? label}</h3><p>Just a moment while we bring everything together.</p></div>;
}
export function ErrorState({ title = 'We couldn’t load this just yet', message, action, onRetry }: { title?: string; message: ReactNode; action?: ReactNode; onRetry?: () => void }) {
  return <div className="tb-state tb-error-state"><span className="tb-state-icon"><Icon name="alert" size={26} /></span><h3>{title}</h3><p role="alert">{message}</p><div className="tb-actions">{onRetry && <SecondaryButton onClick={onRetry} icon="refresh">Try again</SecondaryButton>}{action}</div></div>;
}
export function Feedback({ children, message, tone = 'info', className }: { children?: ReactNode; message?: ReactNode; tone?: Tone; className?: string }) {
  return <div className={cx('tb-feedback', `tb-feedback-${tone}`, className)} role={tone === 'danger' ? 'alert' : 'status'}><Icon name={tone === 'danger' || tone === 'warning' ? 'alert' : tone === 'success' ? 'check' : 'info'} size={18} /><div>{children ?? message}</div></div>;
}
export function Toast({ open = true, children, message, tone = 'success', onClose }: { open?: boolean; children?: ReactNode; message?: ReactNode; tone?: Tone; onClose?: () => void }) {
  if (!open) return null;
  return <div className="tb-toast"><Feedback tone={tone}>{children ?? message}{onClose && <button className="tb-icon-button" type="button" aria-label="Dismiss notification" onClick={onClose}><Icon name="close" size={16} /></button>}</Feedback></div>;
}

export interface TimelineStep { label: string; description?: ReactNode; status?: 'completed' | 'current' | 'upcoming'; }
export function Timeline({ steps, className }: { steps: TimelineStep[]; className?: string }) {
  return <ol className={cx('tb-timeline', className)}>{steps.map((step,index) => <li key={`${index}-${step.label}`} className={cx('tb-timeline-step', `tb-step-${step.status ?? 'upcoming'}`)} aria-current={step.status === 'current' ? 'step' : undefined}><span className="tb-step-node">{step.status === 'completed' ? <Icon name="check" size={14} /> : index + 1}</span><div><strong>{step.label}</strong>{step.description && <p>{step.description}</p>}</div></li>)}</ol>;
}
export function StepIndicator({ steps, currentStep = 0, activeStep, className }: { steps: (string | TimelineStep)[]; currentStep?: number; activeStep?: number; className?: string }) {
  const selected = activeStep ?? currentStep;
  return <Timeline className={cx('tb-step-indicator', className)} steps={steps.map((step,index) => ({ ...(typeof step === 'string' ? { label: step } : step), status: index < selected ? 'completed' : index === selected ? 'current' : 'upcoming' }))} />;
}

export function Modal({ open, title, description, children, footer, onClose }: { open: boolean; title: ReactNode; description?: ReactNode; children: ReactNode; footer?: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => { const dialog = ref.current; if (!dialog) return; if (open && !dialog.open) dialog.showModal(); else if (!open && dialog.open) dialog.close(); }, [open]);
  return <dialog ref={ref} className="tb-modal" aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined} onCancel={event => { event.preventDefault(); onClose(); }}><div className="tb-modal-heading"><h2 id={titleId}>{title}</h2><button className="tb-icon-button" type="button" onClick={onClose} aria-label="Close dialog"><Icon name="close" /></button></div>{description && <p className="tb-muted" id={descriptionId}>{description}</p>}<div className="tb-modal-body">{children}</div>{footer && <div className="tb-actions tb-modal-footer">{footer}</div>}</dialog>;
}
export function ConfirmationDialog({ open, title, description, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false, loading = false, onConfirm, onClose }: { open: boolean; title: string; description: ReactNode; confirmLabel?: string; cancelLabel?: string; danger?: boolean; loading?: boolean; onConfirm: () => void; onClose: () => void }) {
  return <Modal open={open} title={title} onClose={loading ? () => undefined : onClose} footer={<><SecondaryButton onClick={onClose} disabled={loading}>{cancelLabel}</SecondaryButton>{danger ? <DangerButton onClick={onConfirm} loading={loading}>{confirmLabel}</DangerButton> : <PrimaryButton onClick={onConfirm} loading={loading}>{confirmLabel}</PrimaryButton>}</>}><p className="tb-muted">{description}</p></Modal>;
}
