"use client";

import Link from "next/link";
import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { useToast } from "../components/Toast";

export default function AccountPage() {
  const { credentials, updateCredentials, logout } = useAuth();
  const { addToast } = useToast();

  const [form, setForm] = useState({
    name: credentials.name,
    username: credentials.username,
    email: credentials.email,
    password: "",
    confirmPassword: "",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState({});
  const [changingPassword, setChangingPassword] = useState(false);

  const validate = () => {
    const errs = {};
    if (!form.name.trim()) errs.name = "Name is required";
    if (!form.username.trim()) errs.username = "Username is required";
    if (!form.email.trim()) {
      errs.email = "Email is required";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      errs.email = "Please enter a valid email";
    }
    if (changingPassword) {
      if (form.password.length < 8) {
        errs.password = "Password must be at least 8 characters";
      }
      if (form.password !== form.confirmPassword) {
        errs.confirmPassword = "Passwords do not match";
      }
    }
    return errs;
  };

  const handleSave = () => {
    const errs = validate();
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    const updates = {
      name: form.name.trim(),
      username: form.username.trim(),
      email: form.email.trim(),
    };
    if (changingPassword && form.password) {
      updates.password = form.password;
    }

    updateCredentials(updates);

    // If username or password changed, log out so next sign-in uses new creds
    const usernameChanged = updates.username !== credentials.username;
    const passwordChanged = changingPassword && form.password;

    setChangingPassword(false);
    setForm((prev) => ({ ...prev, password: "", confirmPassword: "" }));

    if (usernameChanged || passwordChanged) {
      addToast("Credentials updated — please sign in with your new details", "success");
      setTimeout(() => logout(), 1200);
    } else {
      addToast("Account updated successfully", "success");
    }
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

      <h1 className="form-title">My Account</h1>
      <p className="sub">Manage your profile details.</p>

      <div className="field">
        <label htmlFor="account-name">Name</label>
        <input
          id="account-name"
          placeholder="Your full name"
          value={form.name}
          onChange={(e) => updateField("name", e.target.value)}
          className={errors.name ? "input-error" : ""}
        />
        {errors.name && <div className="field-error">{errors.name}</div>}
      </div>

      <div className="field">
        <label htmlFor="account-username">Username</label>
        <input
          id="account-username"
          placeholder="username"
          value={form.username}
          onChange={(e) => updateField("username", e.target.value)}
          className={errors.username ? "input-error" : ""}
        />
        {errors.username && <div className="field-error">{errors.username}</div>}
      </div>

      <div className="field">
        <label htmlFor="account-email">Email</label>
        <input
          id="account-email"
          type="email"
          placeholder="you@example.com"
          value={form.email}
          onChange={(e) => updateField("email", e.target.value)}
          className={errors.email ? "input-error" : ""}
        />
        {errors.email && <div className="field-error">{errors.email}</div>}
      </div>

      <hr className="section-divider" />

      {!changingPassword ? (
        <button
          className="btn btn--secondary btn--small"
          onClick={() => setChangingPassword(true)}
          style={{ marginBottom: 18 }}
        >
          🔒 Change Password
        </button>
      ) : (
        <>
          <div className="field">
            <label htmlFor="account-password">New Password</label>
            <div className="password-wrap">
              <input
                id="account-password"
                type={showPassword ? "text" : "password"}
                placeholder="Minimum 8 characters"
                value={form.password}
                onChange={(e) => updateField("password", e.target.value)}
                className={errors.password ? "input-error" : ""}
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
            {errors.password && <div className="field-error">{errors.password}</div>}
          </div>

          <div className="field">
            <label htmlFor="account-confirm-password">Confirm Password</label>
            <input
              id="account-confirm-password"
              type={showPassword ? "text" : "password"}
              placeholder="Re-enter your password"
              value={form.confirmPassword}
              onChange={(e) => updateField("confirmPassword", e.target.value)}
              className={errors.confirmPassword ? "input-error" : ""}
            />
            {errors.confirmPassword && (
              <div className="field-error">{errors.confirmPassword}</div>
            )}
          </div>

          <button
            className="btn btn--secondary btn--small"
            onClick={() => {
              setChangingPassword(false);
              setForm((prev) => ({ ...prev, password: "", confirmPassword: "" }));
              setErrors((prev) => {
                const next = { ...prev };
                delete next.password;
                delete next.confirmPassword;
                return next;
              });
            }}
            style={{ marginBottom: 18 }}
          >
            Cancel Password Change
          </button>
        </>
      )}

      <button className="submit" onClick={handleSave}>
        Save Changes
      </button>
    </div>
  );
}
