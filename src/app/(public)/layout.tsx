// Client messages: those of the root layout (SHELL_NAMESPACES, src/i18n/messages.ts).
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      {children}
    </div>
  );
}
