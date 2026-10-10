import * as ImagePicker from "expo-image-picker";
import * as Linking from "expo-linking";
import * as SecureStore from "expo-secure-store";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useState } from "react";
import { Alert, Button, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Api, type Contract, type DocKind, type Readiness, type Role } from "./api";

const FIELD_GROUPS: { title: string; section: "landlord" | "tenant" | "property" | "terms"; fields: string[] }[] = [
  { title: "Landlord", section: "landlord", fields: ["name", "emiratesId", "email", "phone"] },
  { title: "Tenant", section: "tenant", fields: ["name", "emiratesId", "email", "phone"] },
  { title: "Property", section: "property", fields: ["titleDeedNumber", "ownerName", "plotNumber", "makaniNumber", "buildingName", "propertyNumber", "propertyType", "areaSqm", "location", "usage", "premisesNo"] },
  { title: "Terms", section: "terms", fields: ["startDate", "endDate", "annualRent", "contractValue", "securityDeposit", "paymentCheques"] },
];

export default function App() {
  const [baseUrl, setBaseUrl] = useState("http://localhost:3000");
  const [token, setToken] = useState("");
  const [connected, setConnected] = useState(false);
  const [contract, setContract] = useState<Contract>();
  const [readiness, setReadiness] = useState<Readiness>();
  const [busy, setBusy] = useState(false);
  const api = useMemo(() => new Api(baseUrl, token), [baseUrl, token]);

  useEffect(() => {
    SecureStore.getItemAsync("api").then((v) => {
      if (v) {
        const s = JSON.parse(v) as { baseUrl: string; token: string };
        setBaseUrl(s.baseUrl);
        setToken(s.token);
      }
    });
  }, []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      Alert.alert("Error", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const refresh = async (c: Contract) => {
    setContract(c);
    setReadiness(await api.readiness(c.id));
  };

  const scan = (kind: DocKind, party?: Role) =>
    run(async () => {
      if (!contract) return;
      const picked = await ImagePicker.launchCameraAsync({ base64: true, quality: 0.7 });
      const asset = picked.assets?.[0];
      if (picked.canceled || !asset?.base64) return;
      const r = await api.upload(contract.id, kind, party, asset.mimeType ?? "image/jpeg", asset.base64);
      await refresh(r.contract);
    });

  if (!connected) {
    return (
      <SafeAreaView style={s.screen}>
        <ScrollView contentContainerStyle={s.pad}>
          <Text style={s.h1}>Direct Homes pilot</Text>
          <Text style={s.label}>API URL</Text>
          <TextInput style={s.input} value={baseUrl} onChangeText={setBaseUrl} autoCapitalize="none" />
          <Text style={s.label}>Access token</Text>
          <TextInput style={s.input} value={token} onChangeText={setToken} autoCapitalize="none" secureTextEntry />
          <Button
            title="Connect"
            onPress={() =>
              run(async () => {
                await fetch(baseUrl + "/health").then((r) => { if (!r.ok) throw new Error("Server not reachable"); });
                await SecureStore.setItemAsync("api", JSON.stringify({ baseUrl, token }));
                setConnected(true);
              })
            }
          />
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (!contract) {
    return (
      <SafeAreaView style={s.screen}>
        <View style={s.pad}>
          <Text style={s.h1}>New tenancy contract</Text>
          <Button title="Start" onPress={() => run(async () => refresh(await api.create()))} disabled={busy} />
        </View>
      </SafeAreaView>
    );
  }

  const c = contract;
  const editable = c.status === "draft" || c.status === "verified";

  return (
    <SafeAreaView style={s.screen}>
      <StatusBar style="auto" />
      <ScrollView contentContainerStyle={s.pad}>
        <Text style={s.h1}>Contract {c.id.slice(0, 8)}</Text>
        <Text style={s.badge}>Status: {c.status}</Text>

        {editable && !c.consent && (
          <>
            <Text style={s.h2}>0. Data-processing consent</Text>
            <Text>
              Before scanning or entering anyone's details, show the landlord and the tenant the data-processing notice and confirm that each agrees.
              The notice text must be the version approved by Direct Homes' legal counsel.
            </Text>
            <Button title="Both parties have agreed (notice v0-draft)" onPress={() => run(async () => refresh(await api.recordConsent(c.id, "v0-draft")))} />
          </>
        )}

        {editable && c.consent && (
          <>
            <Text style={s.h2}>1. Scan documents</Text>
            <Button title="Scan landlord Emirates ID" onPress={() => scan("emirates_id", "landlord")} />
            <Button title="Scan tenant Emirates ID" onPress={() => scan("emirates_id", "tenant")} />
            <Button title="Scan title deed" onPress={() => scan("title_deed")} />
            <Button title="Scan landlord trade license (companies)" onPress={() => scan("trade_license", "landlord")} />

            <Text style={s.h2}>2. Review and complete</Text>
            {FIELD_GROUPS.map((g) => (
              <View key={g.section}>
                <Text style={s.h3}>{g.title}</Text>
                {g.fields.map((f) => {
                  const path = `${g.section}.${f}`;
                  const prov = c.provenance[path];
                  const flag = prov && !prov.confirmed ? ` (read from document${prov.confidence !== undefined ? `, ${Math.round(prov.confidence * 100)}%` : ""}, check)` : "";
                  return (
                    <View key={path}>
                      <Text style={s.label}>{f}{flag}</Text>
                      <TextInput
                        style={[s.input, prov && !prov.confirmed && s.unconfirmed]}
                        defaultValue={String((c[g.section] as Record<string, unknown>)[f] ?? "")}
                        onEndEditing={(e) => run(async () => refresh(await api.patch(c.id, { [g.section]: { [f]: e.nativeEvent.text } })))}
                        autoCapitalize="none"
                      />
                    </View>
                  );
                })}
              </View>
            ))}
            <Button title="Confirm all values are correct" onPress={() => run(async () => refresh(await api.confirmAll(c.id)))} />

            <Text style={s.h2}>3. Verify</Text>
            {readiness && !readiness.ready && (
              <Text style={s.warn}>
                {[...readiness.missing.map((m) => `Missing: ${m}`), ...readiness.unconfirmed.map((u) => `Unconfirmed: ${u}`), ...readiness.issues.map((i) => i.message)].join("\n")}
              </Text>
            )}
            <Button title="Verify title deed and clearance" disabled={!readiness?.ready || busy} onPress={() => run(async () => refresh(await api.verify(c.id)))} />
            {c.verification && !c.verification.clearance.clear && (
              <Text style={s.warn}>Not clear: {c.verification.clearance.issues.map((i) => i.detail).join("; ")}</Text>
            )}
            {c.verification && !c.verification.titleDeed.valid && <Text style={s.warn}>Title deed: {c.verification.titleDeed.notes.join("; ")}</Text>}
          </>
        )}

        {(c.status === "verified" || c.status === "signing") && (
          <>
            <Text style={s.h2}>4. Sign (UAE PASS)</Text>
            {(["landlord", "tenant"] as Role[]).map((role) => {
              const sig = c.signatures[role];
              return (
                <View key={role}>
                  {!sig && <Button title={`Request ${role} signature`} onPress={() => run(async () => { const r = await api.startSigning(c.id, role); if (r.authUrl) Linking.openURL(r.authUrl).catch(() => {}); await refresh(r.contract); })} />}
                  {sig?.status === "pending" && <Button title={`Check ${role} signature`} onPress={() => run(async () => refresh(await api.completeSigning(c.id, role)))} />}
                  {sig?.status === "signed" && <Text>{role}: signed</Text>}
                </View>
              );
            })}
          </>
        )}

        {c.status === "signed" && (
          <>
            <Text style={s.h2}>5. Deposit and registration</Text>
            {c.terms.useEscrow && !c.escrow && <Button title="Open escrow account" onPress={() => run(async () => refresh(await api.openEscrow(c.id)))} />}
            {c.escrow && <Button title={`Escrow ${c.escrow.status}: refresh`} onPress={() => run(async () => refresh(await api.refreshEscrow(c.id)))} />}
            <Button title="Register with Ejari" onPress={() => run(async () => refresh(await api.registerEjari(c.id)))} />
          </>
        )}

        {c.ejari && <Text style={s.badge}>Ejari: {c.ejari.ejariNumber}</Text>}
        <View style={{ height: 16 }} />
        <Button title="Open contract PDF" onPress={() => run(async () => { await Linking.openURL(await api.pdfUrl(c.id)); })} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#fff" },
  pad: { padding: 16, gap: 8 },
  h1: { fontSize: 22, fontWeight: "700" },
  h2: { fontSize: 17, fontWeight: "600", marginTop: 16 },
  h3: { fontSize: 15, fontWeight: "600", marginTop: 8 },
  label: { fontSize: 12, color: "#555", marginTop: 6 },
  input: { borderWidth: 1, borderColor: "#ccc", borderRadius: 6, padding: 8 },
  unconfirmed: { borderColor: "#d97706", backgroundColor: "#fffbeb" },
  warn: { color: "#b91c1c" },
  badge: { fontWeight: "600" },
});
