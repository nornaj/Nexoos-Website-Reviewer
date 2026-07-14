"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useProjects } from "@/lib/context";
import { useToast } from "../components/Toast";

export default function ReviewForm() {
  const router = useRouter();
  const { addProject } = useProjects();
  const { addToast } = useToast();

  const [form, setForm] = useState({
    url: "",
    name: "",
    reviewerName: "",
    status: "Pending",
    notes: "",
  });
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  const statuses = ["Pending", "Approved", "Changes needed"];

  const validate = () => {
    const errs = {};
    if (!form.url.trim()) {
      errs.url = "Website URL is required";
    } else {
      try {
        const testUrl = form.url.startsWith("http")
          ? form.url
          : `https://${form.url}`;
        new URL(testUrl);
      } catch {
        errs.url = "Please enter a valid URL";
      }
    }
    if (!form.name.trim()) {
      errs.name = "Project name is required";
    }
    return errs;
  };

  const handleSubmit = () => {
    const errs = validate();
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setSubmitting(true);

    const url = form.url.startsWith("http")
      ? form.url
      : `https://${form.url}`;

    const newProject = addProject({
      ...form,
      url,
    });

    addToast(`"${newProject.name}" created`, "success");
    router.push(`/project/${newProject.id}`);
  };

  const updateField = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  return (
    <div className="wrap wrap--narrow page-enter">
      <Link href="/" className="back">
        <span className="back-arrow">←</span> Back to projects
      </Link>

      <h1 className="form-title">New Project Review</h1>
      <p className="sub">
        Fill in the details for the website you&apos;re reviewing.
      </p>

      <div className="url-box">
        <label htmlFor="website-url">Website URL to review *</label>
        <input
          id="website-url"
          type="url"
          placeholder="https://example.com/page-to-review"
          value={form.url}
          onChange={(e) => updateField("url", e.target.value)}
          className={errors.url ? "input-error" : ""}
        />
        {errors.url && <div className="field-error">{errors.url}</div>}
        {!errors.url && (
          <div className="hint">
            This is the page whose copy will be reviewed.
          </div>
        )}
      </div>

      <div className="two-col">
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="project-name">Project name *</label>
          <input
            id="project-name"
            placeholder="Acme Corp Site"
            value={form.name}
            onChange={(e) => updateField("name", e.target.value)}
            className={errors.name ? "input-error" : ""}
          />
          {errors.name && <div className="field-error">{errors.name}</div>}
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="reviewer-name">Reviewer name</label>
          <input
            id="reviewer-name"
            placeholder="Your name"
            value={form.reviewerName}
            onChange={(e) => updateField("reviewerName", e.target.value)}
          />
        </div>
      </div>

      <div className="field">
        <label>Status</label>
        <div className="status-row">
          {statuses.map((status) => (
            <button
              key={status}
              type="button"
              className={`status-chip${form.status === status ? " active" : ""}`}
              onClick={() => updateField("status", status)}
            >
              {status}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label htmlFor="notes">Notes / comments</label>
        <textarea
          id="notes"
          rows={4}
          placeholder="Copy feedback, suggested edits, tone notes…"
          value={form.notes}
          onChange={(e) => updateField("notes", e.target.value)}
        />
      </div>

      <button
        type="button"
        className="submit"
        onClick={handleSubmit}
        disabled={submitting}
      >
        {submitting ? "Creating…" : "Save Review"}
      </button>
    </div>
  );
}
