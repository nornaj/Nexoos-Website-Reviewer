import Link from "next/link";

export default function EmptyState({
  icon = "📋",
  title = "Nothing here yet",
  description = "",
  ctaText = "",
  ctaHref = "",
}) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">{icon}</div>
      <h2 className="empty-state-title">{title}</h2>
      {description && <p className="empty-state-desc">{description}</p>}
      {ctaText && ctaHref && (
        <Link href={ctaHref} className="btn" style={{ marginTop: "8px" }}>
          {ctaText}
        </Link>
      )}
    </div>
  );
}
