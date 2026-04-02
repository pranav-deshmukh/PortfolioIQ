"use client";

interface EmptyStateProps {
  message: string;
}

export default function EmptyState({ message }: EmptyStateProps) {
  return (
    <div className="py-16 text-center text-slate-400">{message}</div>
  );
}
