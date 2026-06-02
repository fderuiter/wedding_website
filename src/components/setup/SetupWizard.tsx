"use client";
import React, { useState } from "react";
import { useRouter } from "next/navigation";

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
    if (baseUrl.includes("abbifred.com")) {
      setError("Please use your own URL, not the default abbifred.com");
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

  if (!isAuthenticated || step === 1) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-rose-50 text-gray-900 p-4">
        <div className="max-w-md w-full bg-white p-8 rounded-xl shadow-lg">
          <h1 className="text-2xl font-bold text-rose-700 mb-4">Welcome to Your Wedding Site!</h1>
          <p className="mb-4 text-gray-600">Please enter the admin password to begin setup (default is <strong>admin</strong>).</p>
          <form onSubmit={handleLogin} className="space-y-4">
            <input
              type="password"
              placeholder="Admin Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-gray-300 p-2 rounded focus:ring-rose-500 focus:border-rose-500"
              required
            />
            {error && <p className="text-red-500 text-sm">{error}</p>}
            <button disabled={loading} className="w-full bg-rose-600 text-white p-2 rounded hover:bg-rose-700 disabled:opacity-50">
              {loading ? "Authenticating..." : "Continue"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (step === 2) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-rose-50 text-gray-900 p-4">
        <div className="max-w-xl w-full bg-white p-8 rounded-xl shadow-lg">
          <h1 className="text-2xl font-bold text-rose-700 mb-4">Step 1: The Essentials</h1>
          <p className="mb-4 text-gray-600">Let's start with your names and when the big day is.</p>
          <form onSubmit={handleSaveConfig} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold mb-1">Partner 1</label>
                <input type="text" value={brideName} onChange={(e) => setBrideName(e.target.value)} className="w-full border border-gray-300 p-2 rounded" required />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">Partner 2</label>
                <input type="text" value={groomName} onChange={(e) => setGroomName(e.target.value)} className="w-full border border-gray-300 p-2 rounded" required />
              </div>
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">Wedding Date</label>
              <input type="date" value={weddingDate} onChange={(e) => setWeddingDate(e.target.value)} className="w-full border border-gray-300 p-2 rounded" required />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">Site URL (e.g. https://ourwedding.com)</label>
              <input type="url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} className="w-full border border-gray-300 p-2 rounded" required />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-3 md:col-span-1">
                <label className="block text-sm font-semibold mb-1">Venue Name</label>
                <input type="text" value={venueName} onChange={(e) => setVenueName(e.target.value)} className="w-full border border-gray-300 p-2 rounded" required />
              </div>
              <div className="col-span-3 md:col-span-1">
                <label className="block text-sm font-semibold mb-1">City</label>
                <input type="text" value={venueCity} onChange={(e) => setVenueCity(e.target.value)} className="w-full border border-gray-300 p-2 rounded" required />
              </div>
              <div className="col-span-3 md:col-span-1">
                <label className="block text-sm font-semibold mb-1">State</label>
                <input type="text" value={venueState} onChange={(e) => setVenueState(e.target.value)} className="w-full border border-gray-300 p-2 rounded" required />
              </div>
            </div>
            {error && <p className="text-red-500 text-sm">{error}</p>}
            <button disabled={loading} className="w-full bg-rose-600 text-white p-2 rounded hover:bg-rose-700 disabled:opacity-50">
              {loading ? "Saving..." : "Next Step"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (step === 3) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-rose-50 text-gray-900 p-4">
        <div className="max-w-2xl w-full bg-white p-8 rounded-xl shadow-lg text-center">
          <h1 className="text-2xl font-bold text-rose-700 mb-4">Step 2: Add Content</h1>
          <p className="mb-6 text-gray-600">Great! Your core details are set. Now let's add some content like your wedding party and things to do in the area.</p>
          <div className="space-y-4">
            <button onClick={() => window.open("/admin/dashboard/wedding-party", "_blank")} className="w-full border-2 border-rose-600 text-rose-600 font-bold p-3 rounded hover:bg-rose-50">
              Manage Wedding Party (Opens in New Tab)
            </button>
            <button onClick={() => window.open("/admin/dashboard/attractions", "_blank")} className="w-full border-2 border-rose-600 text-rose-600 font-bold p-3 rounded hover:bg-rose-50">
              Manage Attractions (Opens in New Tab)
            </button>
          </div>
          <p className="mt-6 mb-4 text-sm text-gray-500">You can also do this later from the Admin Dashboard.</p>
          <button onClick={() => {
            window.location.href = "/";
          }} className="w-full bg-rose-600 text-white p-3 rounded font-bold hover:bg-rose-700">
            Finish Setup & View Site
          </button>
        </div>
      </div>
    );
  }

  return null;
}
