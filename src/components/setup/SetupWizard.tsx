"use client";
import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { FormGroup, Label, Input, FormMessage } from "@/components/ui/forms";
import { AccessibleStep } from "@/components/ui/AccessibleStep";

/**
 * Render a multi-step admin setup wizard for configuring a wedding site.
 *
 * The component presents a login form, an essentials form to collect site and venue details,
 * and a final content step that links to admin pages; it handles authentication and saving
 * settings via the app's admin API endpoints and navigates to the site when setup completes.
 *
 * @returns The setup wizard UI as JSX when active, or `null` when nothing should be rendered.
 */
function isDefaultUrl(url: string): boolean {
  try {
    const urlObj = new URL(url.includes("://") ? url : `https://${url}`);
    return urlObj.hostname === "abbifred.com" || urlObj.hostname.endsWith(".abbifred.com");
  } catch {
    return false;
  }
}

export default function SetupWizard() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  
  // Login
  const [password, setPassword] = useState("");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  
  // Config state
  const [brideName, setBrideName] = useState("");
  const [groomName, setGroomName] = useState("");
  const [weddingDate, setWeddingDate] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [venueName, setVenueName] = useState("");
  const [venueCity, setVenueCity] = useState("");
  const [venueState, setVenueState] = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        setIsAuthenticated(true);
        setStep(2);
      } else {
        setError("Invalid password. Default is 'admin'.");
      }
    } catch (err: any) {
      setError(err.message || "Failed to log in.");
    } finally {
      setLoading(false);
    }
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const urlObj = new URL(baseUrl);
      if (urlObj.hostname === "abbifred.com" || urlObj.hostname.endsWith(".abbifred.com")) {
        setError("Please use your own URL, not the default abbifred.com");
        return;
      }
    } catch (err) {
      // If it's not a valid URL, it will fail backend validation anyway.
      // But we can also set an error here.
      setError("Please enter a valid URL.");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brideName,
          groomName,
          weddingDate,
          baseUrl,
          venueName: venueName || "TBD",
          venueAddress: "TBD",
          venueCity: venueCity || "TBD",
          venueState: venueState || "TBD",
          venueZip: "TBD",
          latitude: 0,
          longitude: 0,
          storyText: "Our story...",
          venueDescription: "Venue description...",
          travelAdvice: "Travel advice...",
          heroTitle: "We Tied the Knot!",
          heroSubtitle: "Thank you for celebrating with us!",
          seoTitle: `${brideName} & ${groomName}'s Wedding`,
          seoDescription: `Join ${brideName} and ${groomName} for their wedding celebration.`,
        }),
      });
      if (res.ok) {
        setStep(3);
      } else {
        setError("Failed to save configuration.");
      }
    } catch (err: any) {
      setError(err.message || "Failed to save config.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <AccessibleStep isActive={!isAuthenticated || step === 1}>
        <div className="min-h-screen flex items-center justify-center bg-rose-50 text-gray-900 p-4">
          <div className="max-w-md w-full bg-white p-8 rounded-xl shadow-lg">
            <h1 className="text-2xl font-bold text-rose-700 mb-4">Welcome to Your Wedding Site!</h1>
            <p className="mb-4 text-gray-600">Please enter the admin password to begin setup (default is <strong>admin</strong>).</p>
            <form onSubmit={handleLogin} className="space-y-4">
              <FormGroup>
                <Label className="sr-only">Admin Password</Label>
                <Input
                  type="password"
                  placeholder="Admin Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </FormGroup>
              {error && <p className="text-red-500 text-sm">{error}</p>}
              <button disabled={loading} className="w-full btn-primary py-3">
                {loading ? "Authenticating..." : "Continue"}
              </button>
            </form>
          </div>
        </div>
      </AccessibleStep>

      <AccessibleStep isActive={isAuthenticated && step === 2}>
        <div className="min-h-screen flex items-center justify-center bg-rose-50 text-gray-900 p-4">
          <div className="max-w-xl w-full bg-white p-8 rounded-xl shadow-lg">
            <h1 className="text-2xl font-bold text-rose-700 mb-4">Step 1: The Essentials</h1>
            <p className="mb-4 text-gray-600">Let's start with your names and when the big day is.</p>
            <form onSubmit={handleSaveConfig} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormGroup>
                  <Label>Partner 1</Label>
                  <Input type="text" value={brideName} onChange={(e) => setBrideName(e.target.value)} required />
                </FormGroup>
                <FormGroup>
                  <Label>Partner 2</Label>
                  <Input type="text" value={groomName} onChange={(e) => setGroomName(e.target.value)} required />
                </FormGroup>
              </div>
              <FormGroup>
                <Label>Wedding Date</Label>
                <Input type="date" value={weddingDate} onChange={(e) => setWeddingDate(e.target.value)} required />
              </FormGroup>
              <FormGroup state={isDefaultUrl(baseUrl) ? "error" : "default"}>
                <Label>Site URL (e.g. https://ourwedding.com)</Label>
                <Input type="url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} required />
                {isDefaultUrl(baseUrl) && <FormMessage>Please use your own URL.</FormMessage>}
              </FormGroup>
              <div className="grid grid-cols-3 gap-4">
                <FormGroup className="col-span-3 md:col-span-1">
                  <Label>Venue Name</Label>
                  <Input type="text" value={venueName} onChange={(e) => setVenueName(e.target.value)} required />
                </FormGroup>
                <FormGroup className="col-span-3 md:col-span-1">
                  <Label>City</Label>
                  <Input type="text" value={venueCity} onChange={(e) => setVenueCity(e.target.value)} required />
                </FormGroup>
                <FormGroup className="col-span-3 md:col-span-1">
                  <Label>State</Label>
                  <Input type="text" value={venueState} onChange={(e) => setVenueState(e.target.value)} required />
                </FormGroup>
              </div>
              {error && <p className="text-red-500 text-sm">{error}</p>}
              <button disabled={loading} className="w-full btn-primary py-3">
                {loading ? "Saving..." : "Next Step"}
              </button>
            </form>
          </div>
        </div>
      </AccessibleStep>

      <AccessibleStep isActive={isAuthenticated && step === 3}>
        <div className="min-h-screen flex items-center justify-center bg-rose-50 text-gray-900 p-4">
          <div className="max-w-2xl w-full bg-white p-8 rounded-xl shadow-lg text-center">
            <h1 className="text-2xl font-bold text-rose-700 mb-4">Step 2: Add Content</h1>
            <p className="mb-6 text-gray-600">Great! Your core details are set. Now let's add some content like your wedding party and things to do in the area.</p>
            <div className="space-y-4">
              <button onClick={() => window.open("/admin/dashboard/wedding-party", "_blank")} className="w-full btn-secondary py-3">
                Manage Wedding Party (Opens in New Tab)
              </button>
              <button onClick={() => window.open("/admin/dashboard/attractions", "_blank")} className="w-full btn-secondary py-3">
                Manage Attractions (Opens in New Tab)
              </button>
            </div>
            <p className="mt-6 mb-4 text-sm text-gray-500">You can also do this later from the Admin Dashboard.</p>
            <button onClick={() => {
              window.location.href = "/";
            }} className="w-full btn-primary py-3">
              Finish Setup & View Site
            </button>
          </div>
        </div>
      </AccessibleStep>
    </>
  );
}
