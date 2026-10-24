"use client";

export interface ToastMsg {
  id: number;
  text: string;
  href?: string;
  linkText?: string;
}

export function toast(text: string, href?: string, linkText?: string) {
  window.dispatchEvent(new CustomEvent<Omit<ToastMsg, "id">>("tb-toast", { detail: { text, href, linkText } }));
}
