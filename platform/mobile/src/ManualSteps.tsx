import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import { Button, StyleSheet, Text, TextInput, View } from "react-native";
import type { Api, Contract, Modes, Role } from "./api";

/**
 * Assisted mode screens. Staff do each official step through its own channel (Dubai REST app or DLD
 * website, trustee centre, paper signing) and record the result here with a photo as evidence.
 */
const today = () => new Date(Date.now() + 4 * 3600_000).toISOString().slice(0, 10); // date in Dubai (UTC+4)
const METHODS = ["cheque", "bank_transfer", "cash", "other"];
const CHANNELS = ["dubai_rest_app", "trustee_centre", "other"];

interface Props {
  api: Api;
  contract: Contract;
  modes: Modes;
  onChange: (c: Contract) => Promise<void>;
  run: (fn: () => Promise<void>) => Promise<void>;
}

export function ManualSteps({ api, contract: c, modes, onChange, run }: Props) {
  const [issue, setIssue] = useState("");
  const [source, setSource] = useState("management company statement");
  const [signedOn, setSignedOn] = useState(today());
  const [method, setMethod] = useState("cheque");
  const [reference, setReference] = useState("");
  const [amount, setAmount] = useState(String(c.terms.securityDeposit ?? ""));
  const [receivedOn, setReceivedOn] = useState(today());
  const [ejariNumber, setEjariNumber] = useState("");
  const [channel, setChannel] = useState("dubai_rest_app");
  const [registeredOn, setRegisteredOn] = useState(today());

  /** Photographs a document and stores it as evidence. Returns its id, or undefined if cancelled. */
  const photo = async (label: string): Promise<string | undefined> => {
    const picked = await ImagePicker.launchCameraAsync({ base64: true, quality: 0.7 });
    const a = picked.assets?.[0];
    if (picked.canceled || !a?.base64) return undefined;
    const r = await api.addEvidence(c.id, label, a.mimeType === "image/png" ? "image/png" : "image/jpeg", a.base64);
    return r.evidence.id;
  };
  const withPhoto = (label: string, fn: (evidenceId: string) => Promise<Contract>) =>
    run(async () => {
      const id = await photo(label);
      if (id) await onChange(await fn(id));
    });

  const canCheck = c.status === "draft" || c.status === "verified";
  const showChecks = canCheck && (modes.titleDeed === "manual" || modes.clearance === "manual");
  const showSigning = (c.status === "verified" || c.status === "signing") && modes.identity === "manual";
  const showDeposit = c.status === "signed" && modes.escrow === "manual" && !c.escrow;
  const showEjari = c.status === "signed" && modes.ejari === "manual" && !c.ejari && (!c.terms.useEscrow || c.escrow?.status === "funded");

  return (
    <View style={s.box}>
      {showChecks && (
        <View style={s.group}>
          <Text style={s.h}>Official checks (staff)</Text>
          {modes.titleDeed === "manual" && (
            <>
              <Text style={s.p}>
                Check the title deed in the Dubai REST app or on the Dubai Land Department website, then photograph the result.
                {c.attestations?.titleDeed ? `  Recorded: ${c.attestations.titleDeed.valid ? "valid" : "problem"}.` : ""}
              </Text>
              <Button title="Deed is valid: photograph result" onPress={() => withPhoto("title deed check", (e) => api.attestTitleDeed(c.id, true, [], [e]))} />
              <Button title="Deed has a problem: photograph result" onPress={() => withPhoto("title deed check", (e) => api.attestTitleDeed(c.id, false, [issue || "Problem found"], [e]))} />
            </>
          )}
          {modes.clearance === "manual" && (
            <>
              <Text style={s.p}>
                Confirm there are no unpaid service charges or open rental disputes (for example from the management company), then photograph the proof.
                {c.attestations?.clearance ? `  Recorded: ${c.attestations.clearance.clear ? "clear" : "not clear"}.` : ""}
              </Text>
              <Text style={s.l}>Where the proof comes from</Text>
              <TextInput style={s.in} value={source} onChangeText={setSource} />
              <Text style={s.l}>If there is a problem, describe it</Text>
              <TextInput style={s.in} value={issue} onChangeText={setIssue} />
              <Button title="Property is clear: photograph proof" onPress={() => withPhoto("clearance proof", (e) => api.attestClearance(c.id, true, source, [], [e]))} />
              <Button
                title="Not clear: photograph proof"
                onPress={() => withPhoto("clearance proof", (e) => api.attestClearance(c.id, false, source, [{ type: "other", detail: issue || "Problem found" }], [e]))}
              />
            </>
          )}
        </View>
      )}

      {showSigning && (
        <View style={s.group}>
          <Text style={s.h}>Signatures on paper</Text>
          <Text style={s.p}>Open the contract PDF and print it, have each party sign, then photograph the signed copy here. Starting signing locks the contract so it cannot be edited.</Text>
          <Text style={s.l}>Date written on the signed copy (YYYY-MM-DD)</Text>
          <TextInput style={s.in} value={signedOn} onChangeText={setSignedOn} autoCapitalize="none" />
          {(["landlord", "tenant"] as Role[]).map((role) => {
            const sig = c.signatures[role];
            return (
              <View key={role} style={s.row}>
                {!sig && <Button title={`Start signing: ${role}`} onPress={() => run(async () => onChange((await api.startSigning(c.id, role)).contract))} />}
                {sig?.status === "pending" && <Button title={`Record signed copy: ${role}`} onPress={() => withPhoto(`signed copy ${role}`, (e) => api.attestSignature(c.id, role, signedOn, [e]))} />}
                {sig?.status === "signed" && <Text style={s.p}>{role}: signed {sig.signedOn ?? ""}</Text>}
              </View>
            );
          })}
        </View>
      )}

      {showDeposit && (
        <View style={s.group}>
          <Text style={s.h}>Security deposit received</Text>
          <Text style={s.l}>How was it paid?</Text>
          <View style={s.chips}>{METHODS.map((m) => <Button key={m} title={m === method ? `[${m}]` : m} onPress={() => setMethod(m)} />)}</View>
          <Text style={s.l}>Cheque number or transfer reference</Text>
          <TextInput style={s.in} value={reference} onChangeText={setReference} autoCapitalize="none" />
          <Text style={s.l}>Amount (AED)</Text>
          <TextInput style={s.in} value={amount} onChangeText={setAmount} />
          <Text style={s.l}>Date received (YYYY-MM-DD)</Text>
          <TextInput style={s.in} value={receivedOn} onChangeText={setReceivedOn} autoCapitalize="none" />
          <Button title="Record deposit: photograph receipt" onPress={() => withPhoto("deposit receipt", (e) => api.attestDeposit(c.id, { method, reference, amount, receivedOn, evidenceIds: [e] }))} />
        </View>
      )}

      {showEjari && (
        <View style={s.group}>
          <Text style={s.h}>Ejari registration (staff)</Text>
          <Text style={s.p}>Register the contract in the Dubai REST app or at a real estate service trustee centre, then record the Ejari number from the certificate.</Text>
          <Text style={s.l}>Ejari number</Text>
          <TextInput style={s.in} value={ejariNumber} onChangeText={setEjariNumber} autoCapitalize="none" />
          <Text style={s.l}>Registered through</Text>
          <View style={s.chips}>{CHANNELS.map((m) => <Button key={m} title={m === channel ? `[${m}]` : m} onPress={() => setChannel(m)} />)}</View>
          <Text style={s.l}>Date registered (YYYY-MM-DD)</Text>
          <TextInput style={s.in} value={registeredOn} onChangeText={setRegisteredOn} autoCapitalize="none" />
          <Button title="Record Ejari: photograph certificate" onPress={() => withPhoto("ejari certificate", (e) => api.attestEjari(c.id, { ejariNumber, channel, registeredOn, evidenceIds: [e] }))} />
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  box: { gap: 12 },
  group: { gap: 8, borderTopWidth: 1, borderColor: "#ddd", paddingTop: 12 },
  h: { fontSize: 17, fontWeight: "600" },
  p: { fontSize: 14 },
  l: { fontSize: 12, color: "#555", marginTop: 4 },
  in: { borderWidth: 1, borderColor: "#ccc", borderRadius: 6, padding: 8 },
  row: { gap: 4 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
});
