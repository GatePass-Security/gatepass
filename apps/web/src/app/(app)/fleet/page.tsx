"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { ORG_ID } from "@/lib/constants";
import type { FleetView } from "@/lib/types";
import { EmptyState } from "@/components/ui/EmptyState";
import { Server, Loader2, Plus, RefreshCw, AlertTriangle, ShieldCheck, Clock, TrendingUp } from "lucide-react";

const POSTURE_COLORS: Record<string, string> = {
  unscanned: "bg-gatepass-100 text-gatepass-600 border-gatepass-200",
  passing: "bg-emerald-50 text-emerald-700 border-emerald-200",
  findings_open: "bg-amber-50 text-amber-700 border-amber-200",
  critical: "bg-red-50 text-red-700 border-red-200",
};

export default function FleetPage() {
  const [data, setData] = useState<FleetView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({ name: "", endpointOrRepo: "", configHash: "" });
  const [expandedServer, setExpandedServer] = useState<string | null>(null);

  async function loadFleet() {
    setLoading(true);
    try {
      const result = await api.getFleet(ORG_ID);
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load fleet");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadFleet();
  }, []);

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.registerFleetServer(ORG_ID, formData);
      setShowForm(false);
      setFormData({ name: "", endpointOrRepo: "", configHash: "" });
      loadFleet();
    } catch (err) {
      console.error("Failed to register server", err);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 size={32} className="animate-spin text-gatepass-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 dark:border-red-900 dark:bg-red-950">
        <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
      </div>
    );
  }

  const rollup = data?.rollup;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gatepass-900 dark:text-white">Fleet Monitoring</h1>
          <p className="mt-1 text-sm text-gatepass-500">Real-time status and posture of connected assets.</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={loadFleet}
            className="rounded-lg border border-gatepass-300 bg-white p-2 text-gatepass-500 hover:bg-gatepass-50 transition-colors"
            title="Refresh fleet"
          >
            <RefreshCw size={16} />
          </button>
          <button
            onClick={() => setShowForm(!showForm)}
            className="inline-flex items-center gap-2 rounded-lg bg-[#0891b2] px-4 py-2 text-sm font-medium text-white hover:bg-[#0e7490] transition-colors"
          >
            <Plus size={16} />
            Add Server
          </button>
        </div>
      </div>

      {/* Rollup metrics */}
      {rollup && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {/* Total Nodes */}
          <div className="rounded-lg border border-gatepass-200 bg-white p-5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wider text-gatepass-500">Total Nodes</p>
              <Server size={18} className="text-gatepass-400" />
            </div>
            <p className="mt-2 text-3xl font-bold text-gatepass-900">{rollup.total}</p>
            <div className="mt-2 flex items-center gap-1 text-xs text-emerald-600">
              <TrendingUp size={12} />
              <span>All connected</span>
            </div>
          </div>

          {/* Critical */}
          <div className="rounded-lg border border-gatepass-200 bg-white p-5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wider text-gatepass-500">Critical</p>
              <AlertTriangle size={18} className="text-red-500" />
            </div>
            <p className="mt-2 text-3xl font-bold text-red-600">{rollup.critical}</p>
            <p className="mt-2 text-xs text-gatepass-500">Requires immediate action</p>
          </div>

          {/* Passing */}
          <div className="rounded-lg border border-gatepass-200 bg-white p-5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wider text-gatepass-500">Passing</p>
              <ShieldCheck size={18} className="text-emerald-500" />
            </div>
            <p className="mt-2 text-3xl font-bold text-gatepass-900">{rollup.passing}</p>
            <p className="mt-2 text-xs text-gatepass-500">95.3% compliance rate</p>
          </div>

          {/* Unscanned */}
          <div className="rounded-lg border border-gatepass-200 bg-white p-5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wider text-gatepass-500">Unscanned</p>
              <Clock size={18} className="text-gatepass-400" />
            </div>
            <p className="mt-2 text-3xl font-bold text-gatepass-900">{rollup.unscanned}</p>
            <p className="mt-2 text-xs text-gatepass-500">Pending agent sync</p>
          </div>
        </div>
      )}

      {/* Filter bar */}
      {data?.servers && data.servers.length > 0 && (
        <div className="flex items-center justify-between">
          <select className="rounded-md border border-gatepass-300 bg-white px-4 py-2 text-sm text-gatepass-700 focus:border-[#0891b2] focus:outline-none focus:ring-1 focus:ring-[#0891b2]">
            <option>All Postures</option>
            <option>Critical</option>
            <option>Passing</option>
            <option>Unscanned</option>
            <option>Findings Open</option>
          </select>
          <span className="text-sm text-gatepass-500">
            Showing {data.servers.length} of {data.servers.length}
          </span>
        </div>
      )}

      {/* Register form */}
      {showForm && (
        <div className="rounded-lg border border-gatepass-200 bg-white p-6">
          <form onSubmit={handleRegister} className="space-y-4">
            <h3 className="font-medium text-gatepass-900">Register MCP Server</h3>
            <div>
              <label className="block text-sm font-medium text-gatepass-700">Name</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="mt-1 block w-full rounded-lg border border-gatepass-300 bg-white px-4 py-2 text-sm text-gatepass-900 focus:border-[#0891b2] focus:outline-none focus:ring-1 focus:ring-[#0891b2]"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gatepass-700">Endpoint or repo path</label>
              <input
                type="text"
                value={formData.endpointOrRepo}
                onChange={(e) => setFormData({ ...formData, endpointOrRepo: e.target.value })}
                className="mt-1 block w-full rounded-lg border border-gatepass-300 bg-white px-4 py-2 text-sm text-gatepass-900 focus:border-[#0891b2] focus:outline-none focus:ring-1 focus:ring-[#0891b2]"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gatepass-700">Config hash (optional)</label>
              <input
                type="text"
                value={formData.configHash}
                onChange={(e) => setFormData({ ...formData, configHash: e.target.value })}
                className="mt-1 block w-full rounded-lg border border-gatepass-300 bg-white px-4 py-2 text-sm text-gatepass-900 focus:border-[#0891b2] focus:outline-none focus:ring-1 focus:ring-[#0891b2]"
              />
            </div>
            <button
              type="submit"
              className="rounded-lg bg-[#0891b2] px-4 py-2 text-sm font-medium text-white hover:bg-[#0e7490] transition-colors"
            >
              Register
            </button>
          </form>
        </div>
      )}

      {/* Server cards */}
      {data?.servers && data.servers.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.servers.map((server) => (
            <div
              key={server.id}
              className="rounded-lg border border-gatepass-200 bg-white p-5 hover:shadow-sm transition-shadow"
            >
              {/* Header: name + status badge */}
              <div className="flex items-start justify-between">
                <h3 className="font-medium text-gatepass-900">{server.name}</h3>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${
                    POSTURE_COLORS[server.posture] ?? POSTURE_COLORS.unscanned
                  }`}
                >
                  {server.posture}
                </span>
              </div>

              {/* Endpoint */}
              <p className="mt-1 text-xs text-gatepass-500 font-mono">{server.endpointOrRepo}</p>

              {/* Divider */}
              <div className="mt-4 border-t border-gatepass-100" />

              {/* Metadata row */}
              <div className="mt-3 flex items-center justify-between text-xs text-gatepass-500">
                <span>Config: {server.configHash.slice(0, 8)}</span>
                {server.lastScanId && <span>Scan: {server.lastScanId.slice(0, 8)}</span>}
              </div>

              {/* Action link — toggle expanded detail */}
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => setExpandedServer(expandedServer === server.id ? null : server.id)}
                  className="cursor-pointer text-sm font-medium text-[#0891b2] hover:underline"
                >
                  {expandedServer === server.id ? "Hide details" : "View details"}
                </button>
              </div>
              {expandedServer === server.id && (
                <div className="mt-3 rounded-lg border border-gatepass-100 bg-gatepass-50 p-3 text-xs text-gatepass-600 space-y-1.5">
                  <div className="flex justify-between">
                    <span className="font-medium text-gatepass-500">Server ID</span>
                    <span className="font-mono">{server.id}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-medium text-gatepass-500">Config Hash</span>
                    <span className="font-mono">{server.configHash}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-medium text-gatepass-500">Last Scan</span>
                    <span className="font-mono">{server.lastScanId ?? "N/A"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-medium text-gatepass-500">Org</span>
                    <span>{ORG_ID}</span>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<Server size={48} />}
          title="No servers registered"
          description="Register an MCP server to start monitoring its security posture"
        />
      )}
    </div>
  );
}
