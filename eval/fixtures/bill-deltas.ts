/**
 * Eval fixtures — deterministic stage-1/2 OUTPUT for the 5 benchmark bills.
 *
 * These records mirror EXACTLY what stages 1–2 will eventually emit
 * (`ProvisionDelta` → `operations[]` keyed `"<actSlug>#<opIndex>"` → `rows[]`
 * with `after`/optional `before` `ActProvision`; matching `approvals.json`
 * `keys[]`). They are authored from each bill's REAL clause text in
 * `server/data/bills.json` (`clauses[]`) — every `instruction` is the bill's
 * verbatim amending wording, and every `after.text` is the operative new/
 * changed provision text. No statutory text is invented.
 *
 * Stages 3–4 (the scorer and brief agents) read `instruction` + `afterText`,
 * so omitting `before` on a `replace`/`amend` op (we don't hold the prior Act
 * text here) is fine — when real stages 1–2 land, they replace these fixtures
 * with no change to stages 3–4.
 *
 * Records carry `__evalSeed: true` so the Playwright teardown leaves them.
 *
 * Multi-Act note: C-273 amends 5 Acts → 5 `ProvisionDelta` entries; C-251
 * amends 2 Acts → 2 entries. Short-title and bare coming-into-force clauses
 * are NOT approved ops (mirrors the C-265 demo, which skipped its CIF clause).
 */

const CREATED_AT = "2026-06-13T00:00:00.000Z";

// ── builders (field-for-field with the real schema) ──
type Op = "add" | "replace" | "amend" | "repeal";

interface Item {
  /** Bill clause number this op came from. */
  clause: string;
  op: Op;
  /** The existing Act provision being amended/anchored to (null = transitional). */
  anchor: string | null;
  /** Provision label, e.g. "4.1" or "3(1)(a)". */
  label: string;
  marginalNote: string;
  /** The bill's verbatim amending instruction. */
  instruction: string;
  /** The operative new/changed provision text (the "after" side). */
  text: string;
}

function buildDelta(slug: string, title: string, citation: string, items: Item[]) {
  const rows = items.map((it) => ({
    status: it.op === "add" ? "added" : "changed",
    label: it.label,
    after: {
      id: `${slug}-${it.label}`,
      label: it.label,
      kind: "section",
      marginalNote: it.marginalNote,
      text: it.text,
    },
  }));
  const operations = items.map((it, i) => ({
    key: `${slug}#${i}`,
    clause: it.clause,
    op: it.op,
    anchor: it.anchor,
    position: it.op === "add" ? "after" : null,
    count: 1,
    newLabel: null,
    newMarginalNote: it.marginalNote,
    newText: it.text,
    note: null,
    anchorFound: it.anchor !== null,
    resolution: "structured",
    instruction: it.instruction,
    producedRowIndices: [i],
    contextRowIndices: [i],
  }));
  const added = rows.filter((r) => r.status === "added").length;
  return {
    slug,
    title,
    citation,
    summary: { added, changed: rows.length - added, repealed: 0, unchanged: 0 },
    operations,
    rows,
    source: "bill-xml" as const,
    incomplete: false,
  };
}

type Delta = ReturnType<typeof buildDelta>;

function deltaRecord(billId: string, deltas: Delta[]) {
  return { id: billId, __evalSeed: true, deltas, errors: [] as string[], createdAt: CREATED_AT };
}
function approvalRecord(billId: string, deltas: Delta[]) {
  return {
    id: billId,
    __evalSeed: true,
    keys: deltas.flatMap((d) => d.operations.map((o) => o.key)),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// C-273 — Facilitating Agricultural Regulatory Modernization Act (5 Acts)
// ─────────────────────────────────────────────────────────────────────────────
const C273_FEEDS = buildDelta("feeds-act", "Feeds Act", "R.S.C., 1985, c. F-9", [
  {
    clause: "2",
    op: "add",
    anchor: "2",
    label: "trusted jurisdiction",
    marginalNote: "Definition — trusted jurisdiction",
    instruction:
      "Section 2 of the Feeds Act is amended by adding the following in alphabetical order: trusted jurisdiction means a foreign state or a subdivision of a foreign state that is designated by regulation; (État de confiance)",
    text: "trusted jurisdiction means a foreign state or a subdivision of a foreign state that is designated by regulation.",
  },
  {
    clause: "3",
    op: "replace",
    anchor: "3(1)(a)",
    label: "3(1)(a)",
    marginalNote: "Prohibition — provisional or final approval",
    instruction:
      "Paragraph 3(1)(a) of the Act is replaced by the following: (a) has, in accordance with the regulations, been approved by the Minister, or registered, on a provisional or final basis;",
    text: "(a) has, in accordance with the regulations, been approved by the Minister, or registered, on a provisional or final basis;",
  },
  {
    clause: "4",
    op: "add",
    anchor: "4",
    label: "4.1",
    marginalNote: "Provisional approval or registration",
    instruction:
      "The Act is amended by adding the following after section 4: Provisional and Final Approval or Registration.",
    text: "4.1 (1) If a feed is approved for manufacture, sale or import under the legislation of at least two trusted jurisdictions, the Minister must, in accordance with the regulations, approve or register the feed on a provisional basis within 90 days of the submission of a complete application for approval or registration of the feed, unless during that time, the feed is found not to be in compliance with this Act or the regulations. (2) Once an application for approval or registration of a feed has been evaluated, the Minister must, in accordance with the regulations, approve or register the feed on a final basis if the feed is found to be in compliance with this Act and the regulations.",
  },
  {
    clause: "5",
    op: "replace",
    anchor: "5(1)",
    label: "5(1)",
    marginalNote: "Regulations — trusted jurisdictions; provisional/final registration",
    instruction:
      "Paragraphs 5(1)(b) to (c) of the Act are replaced, and paragraph 5(1)(h) of the Act is replaced, to add regulation-making powers respecting trusted jurisdictions, provisional and final registration/approval, reliance on trusted-jurisdiction evidence, and deeming of feeds containing a pest control product to be registered under the Pest Control Products Act.",
    text: "(a.1) designating, as trusted jurisdictions, foreign states or subdivisions of foreign states for the purposes of this Act; (b) respecting the registration of feeds on a provisional or final basis and prescribing fees for registration on a final basis; (b.1) respecting the approval of feeds on a provisional or final basis; (b.2) respecting the reliance that may be placed on evidence and information furnished in connection with the feed's approval for manufacture, sale or import under the legislation of any trusted jurisdiction; (c) respecting the duration and cancellation of the registration or approval of feeds on a provisional or final basis; (h) providing that feeds registered, on a provisional or final basis, and containing a pest control product as defined in subsection 2(1) of the Pest Control Products Act are, in prescribed circumstances and subject to prescribed conditions, deemed to be registered under that Act.",
  },
]);

const C273_FERT = buildDelta("fertilizers-act", "Fertilizers Act", "R.S.C., 1985, c. F-10", [
  {
    clause: "6",
    op: "add",
    anchor: "2",
    label: "trusted jurisdiction",
    marginalNote: "Definition — trusted jurisdiction",
    instruction:
      "Section 2 of the Fertilizers Act is amended by adding the following in alphabetical order: trusted jurisdiction means a foreign state or a subdivision of a foreign state that is designated by regulation; (État de confiance)",
    text: "trusted jurisdiction means a foreign state or a subdivision of a foreign state that is designated by regulation.",
  },
  {
    clause: "7",
    op: "replace",
    anchor: "3(a)",
    label: "3(a)",
    marginalNote: "Prohibition — provisional or final approval",
    instruction:
      "Paragraph 3(a) of the Act is replaced by the following: (a) has, in accordance with the regulations, been approved by the Minister or registered, on a provisional or final basis;",
    text: "(a) has, in accordance with the regulations, been approved by the Minister or registered, on a provisional or final basis;",
  },
  {
    clause: "8",
    op: "add",
    anchor: "4",
    label: "4.1",
    marginalNote: "Provisional approval or registration",
    instruction:
      "The Act is amended by adding the following after section 4: Provisional and Final Approval or Registration.",
    text: "4.1 (1) If a fertilizer or supplement is approved for manufacture, sale or import under the legislation of at least two trusted jurisdictions, the Minister must, in accordance with the regulations, approve or register the fertilizer or supplement on a provisional basis within 90 days of the submission of a complete application for approval or registration, unless during that time it is found not to be in compliance with this Act or the regulations. (2) Once an application has been evaluated, the Minister must approve or register the fertilizer or supplement on a final basis if it is found to be in compliance with this Act and the regulations.",
  },
  {
    clause: "9",
    op: "replace",
    anchor: "5(1)",
    label: "5(1)",
    marginalNote: "Regulations — trusted jurisdictions; provisional/final registration",
    instruction:
      "Paragraphs 5(1)(b) to (c) and paragraph 5(1)(h) of the Act are replaced to add regulation-making powers respecting trusted jurisdictions, provisional and final registration/approval of fertilizers and supplements, reliance on trusted-jurisdiction evidence, and deeming under the Pest Control Products Act.",
    text: "(a.1) designating, as trusted jurisdictions, foreign states or subdivisions of foreign states for the purposes of this Act; (b) respecting the registration of fertilizers and supplements on a provisional or final basis and prescribing fees for registration on a final basis; (b.1) respecting the approval of fertilizers and supplements on a provisional or final basis; (b.2) respecting the reliance that may be placed on evidence and information furnished in connection with the fertilizer or supplement's approval for manufacture, sale or import under the legislation of any trusted jurisdiction; (c) respecting the duration and cancellation of the registration or approval on a provisional or final basis; (h) providing that fertilizers registered, on a provisional or final basis, and containing a pest control product as defined in subsection 2(1) of the Pest Control Products Act are, in prescribed circumstances and subject to prescribed conditions, deemed to be registered under that Act.",
  },
]);

const C273_SEEDS = buildDelta("seeds-act", "Seeds Act", "R.S.C., 1985, c. S-8", [
  {
    clause: "10",
    op: "add",
    anchor: "2",
    label: "trusted jurisdiction",
    marginalNote: "Definition — trusted jurisdiction",
    instruction:
      "Section 2 of the Seeds Act is amended by adding the following in alphabetical order: trusted jurisdiction means a foreign state or a subdivision of a foreign state that is designated by regulation; (État de confiance)",
    text: "trusted jurisdiction means a foreign state or a subdivision of a foreign state that is designated by regulation.",
  },
  {
    clause: "11",
    op: "replace",
    anchor: "3(1)(b)",
    label: "3(1)(b)",
    marginalNote: "Prohibition — sale of unregistered variety",
    instruction:
      "Paragraph 3(1)(b) of the Act is replaced by the following: (b) sell or advertise for sale in Canada or import into Canada seed of a variety that is not registered, on a provisional or final basis, in the prescribed manner.",
    text: "(b) sell or advertise for sale in Canada or import into Canada seed of a variety that is not registered, on a provisional or final basis, in the prescribed manner.",
  },
  {
    clause: "12",
    op: "add",
    anchor: "3.2",
    label: "3.3",
    marginalNote: "Provisional registration",
    instruction:
      "The Act is amended by adding the following after section 3.2: Provisional and Final Registration.",
    text: "3.3 (1) If a variety of seed is approved for sale under the legislation of at least two trusted jurisdictions, the Registrar must register the variety, in accordance with the regulations, on a provisional basis within 90 days of the submission of a complete application unless, during that time, the Registrar determines that the prescribed requirements are not met. (2) Once an application has been evaluated, the Registrar must register the variety on a final basis if the prescribed requirements are met. (3) For the purposes of this section, Registrar means the person designated by the President of the Canadian Food Inspection Agency to register varieties.",
  },
  {
    clause: "13",
    op: "amend",
    anchor: "4(1)",
    label: "4(1)",
    marginalNote: "Regulations — trusted jurisdictions; provisional registration",
    instruction:
      "Subsection 4(1) of the Act is amended by adding paragraphs (h.11) and (h.12) after paragraph (h.1), and paragraph 4(1)(h.2) is replaced.",
    text: "(h.11) designating, as trusted jurisdictions, foreign states or subdivisions of foreign states for the purposes of this Act; (h.12) respecting the reliance that may be placed on evidence and information furnished in connection with the seed's approval for sale under the legislation of any trusted jurisdiction; (h.2) respecting the registration, on a provisional or final basis, of varieties of seeds and the amendment of the register of such varieties.",
  },
]);

const C273_PCPA = buildDelta(
  "pest-control-products-act",
  "Pest Control Products Act",
  "S.C. 2002, c. 28",
  [
    {
      clause: "14",
      op: "amend",
      anchor: "2(1)",
      label: "2(1)",
      marginalNote: "Definitions — conditions of registration; trusted jurisdiction",
      instruction:
        "Paragraph (a) of the definition conditions of registration in subsection 2(1) is replaced, and subsection 2(1) is amended by adding trusted jurisdiction in alphabetical order.",
      text: "(a) any conditions specified by the Minister under paragraph 7.1(1)(a) or 8(1)(a) or subsection 8(2) or when amending the registration of a pest control product under this Act; and trusted jurisdiction means a foreign state or a subdivision of a foreign state that is designated by regulation.",
    },
    {
      clause: "15",
      op: "amend",
      anchor: "7",
      label: "7(2.2)",
      marginalNote: "Approval by trusted jurisdictions",
      instruction:
        "Section 7 is amended by adding subsection (2.2) after subsection (2.1); the portion of subsection 7(3) before paragraph (a) is replaced; and subsection 7(9) is replaced.",
      text: "(2.2) For the purposes of subsection (1), if a pest control product is approved for use under the legislation of at least two trusted jurisdictions, the applicant may apply to register the pest control product on a provisional basis by including information available from the reviews or evaluations conducted by the relevant authorities of those trusted jurisdictions. (9) In determining whether the health and environmental risks and the value of a pest control product are acceptable, the Minister may take into account information from a review or evaluation conducted by the relevant authority of a trusted jurisdiction.",
    },
    {
      clause: "16",
      op: "add",
      anchor: "7",
      label: "7.1",
      marginalNote: "Provisional registration",
      instruction:
        "The Act is amended by adding the following after section 7: Provisional registration.",
      text: "7.1 (1) If, within 90 days of the submission of a complete application made in accordance with subsections 7(1) and (2.2), the Minister does not determine that the health and environmental risks and the value of the pest control product are unacceptable, the Minister must register the pest control product on a provisional basis by specifying conditions and assigning a registration number. (2) The Minister must require product safety information, including a material safety data sheet, to be provided to workplaces. (3) Provisional registration is valid until the product is registered under section 8 or the application is withdrawn or denied.",
    },
    {
      clause: "17",
      op: "replace",
      anchor: "28(1)(a)",
      label: "28(1)(a)",
      marginalNote: "Public consultation before decision",
      instruction:
        "Subparagraphs 28(1)(a)(i) and (ii) of the Act are replaced by the following.",
      text: "(i) to register under section 8 a pest control product that is or contains an unregistered active ingredient, or (ii) to register or amend the registration of, under section 8, a pest control product if the Minister considers that the registration or amendment may result in significantly increased health or environmental risks;",
    },
    {
      clause: "18",
      op: "amend",
      anchor: "67(1)",
      label: "67(1)",
      marginalNote: "Regulations — trusted jurisdictions; provisional registration",
      instruction:
        "Subsection 67(1) is amended by adding paragraph (e.1) after paragraph (e); and the portion of paragraph 67(1)(f) before subparagraph (i) is replaced.",
      text: "(e.1) designating, as trusted jurisdictions, foreign states or subdivisions of foreign states for the purposes of this Act; (f) respecting the registration and provisional registration of pest control products, including the types of registration for classes of products, and, for each type,",
    },
  ],
);

const C273_FDA = buildDelta(
  "food-and-drugs-act",
  "Food and Drugs Act",
  "R.S.C., 1985, c. F-27",
  [
    {
      clause: "19",
      op: "replace",
      anchor: "30.06(1)",
      label: "30.06(1)",
      marginalNote: "Deeming order — foreign regulatory authority",
      instruction:
        "Subsection 30.06(1) of the Food and Drugs Act is replaced by the following: Deeming order.",
      text: "30.06 (1) Subject to subsection (2) and any regulations made under paragraph 30(1)(j.1), the Minister may, by order, deem that specified requirements of this Act or the regulations are met — in respect of a therapeutic product, a veterinary drug or food that belongs to a class specified in the order — on the basis of a decision of, or any information or document produced by, a foreign regulatory authority in respect of that therapeutic product, veterinary drug or food.",
    },
  ],
);

const C273_DELTAS = [C273_FEEDS, C273_FERT, C273_SEEDS, C273_PCPA, C273_FDA];

// ─────────────────────────────────────────────────────────────────────────────
// C-233 — An Act to amend the Export and Import Permits Act
// ─────────────────────────────────────────────────────────────────────────────
const C233_EIPA = buildDelta(
  "export-and-import-permits-act",
  "Export and Import Permits Act",
  "R.S.C., 1985, c. E-19",
  [
    {
      clause: "1",
      op: "add",
      anchor: "2",
      label: "2(1.01)",
      marginalNote: "Arms, ammunition, implements or munitions of war",
      instruction:
        "Section 2 of the Export and Import Permits Act is amended by adding the following after subsection (1).",
      text: "(1.01) For the purposes of this Act, the expression “arms, ammunition, implements or munitions of war” includes any parts, components or technology necessary for the assembly or use, in whole or in part, of arms, ammunition, implements or munitions of war.",
    },
    {
      clause: "2",
      op: "amend",
      anchor: "3",
      label: "3(1)(a) / 3(3)",
      marginalNote: "No country exemptions — military goods and technology",
      instruction:
        "Paragraph 3(1)(a) of the Act is replaced, and section 3 is amended by adding subsection (3) after subsection (2).",
      text: "(a) to ensure that arms, ammunition, implements or munitions of war … will not be made available to any destination where their use might be detrimental to the security of Canada or where there is a substantial risk that they would be used to commit or facilitate genocide, crimes against humanity, grave breaches of the Geneva Conventions, attacks against civilians, or other war crimes as defined by international agreements to which Canada is a party. (3) Despite subsection (2), the Export Control List must not provide for the exemption of arms, ammunition, implements or munitions of war from export control on the basis of their destination.",
    },
    {
      clause: "3",
      op: "add",
      anchor: "7(1.1)",
      label: "7(1.2)",
      marginalNote: "No general permits for military goods or technology",
      instruction: "Section 7 of the Act is amended by adding the following after subsection (1.1).",
      text: "(1.2) The Minister must not issue a general permit under subsection (1.1) to export arms, ammunition, implements or munitions of war.",
    },
    {
      clause: "4",
      op: "add",
      anchor: "7.1(2)",
      label: "7.1(3)",
      marginalNote: "No general permits to broker for military goods or technology",
      instruction: "Section 7.1 of the Act is amended by adding the following after subsection (2).",
      text: "(3) The Minister must not issue a general permit to broker under subsection (2) to export arms, ammunition, implements or munitions of war.",
    },
    {
      clause: "5",
      op: "amend",
      anchor: "7.3(1)",
      label: "7.3(1)",
      marginalNote: "Factors — Arms Trade Treaty",
      instruction:
        "The portion of paragraph 7.3(1)(b) before subparagraph (i) is replaced, and subsection 7.3(1) is amended by adding paragraph (c).",
      text: "(b) could be used to commit or facilitate, whether in the destination country or the country of end use, … and (c) would be exported to a country that is a party to the Arms Trade Treaty.",
    },
    {
      clause: "6",
      op: "add",
      anchor: "7.3",
      label: "7.31",
      marginalNote: "End-use certificate — mitigation",
      instruction: "The Act is amended by adding the following after section 7.3: End-use certificate — mitigation.",
      text: "7.31 Before issuing a permit under subsection 7(1) or 7.1(1) in respect of arms, ammunition, implements or munitions of war, the Minister shall require that the applicant provide a certificate concerning the end use of the goods or technology from the government of the country to which they are to be exported, if the Minister considers that there is a substantial risk that, without the certificate, the export or brokering could result in a violation or act referred to in paragraph 7.3(1)(b) and that the certificate would be a sufficient measure to mitigate that risk.",
    },
    {
      clause: "7",
      op: "add",
      anchor: "12",
      label: "12(a.4)",
      marginalNote: "Regulations — end-use certificates",
      instruction: "Section 12 of the Act is amended by adding the following after paragraph (a.3).",
      text: "(a.4) respecting the form and contents of certificates required under section 7.31;",
    },
    {
      clause: "8",
      op: "replace",
      anchor: "27",
      label: "27",
      marginalNote: "Annual report — military goods and technology",
      instruction: "Section 27 of the Act is replaced by the following: Annual report — operations.",
      text: "27 (1) No later than May 31 of each year, the Minister must prepare and table in each House of Parliament a report of the operations under this Act for the preceding year. (2) The Minister must also table a report in respect of arms, ammunition, implements and munitions of war exported in the preceding year under an export permit issued under subsection 7(1). (3) That report must include a list of the export permits issued, the types and quantities exported each month (listed by item number under A Guide to Canada's Export Control List), including value and destination countries, a summary of the section 7.3(1) considerations for each permit, a summary of each decision not to issue a permit under section 7.4, and measures taken to ensure Canada's compliance with the Arms Trade Treaty.",
    },
  ],
);

const C233_DELTAS = [C233_EIPA];

// ─────────────────────────────────────────────────────────────────────────────
// C-250 — Flight Attendants' Remuneration Act (amends the Canada Labour Code)
// ─────────────────────────────────────────────────────────────────────────────
const C250_CLC = buildDelta("canada-labour-code", "Canada Labour Code", "R.S.C., 1985, c. L-2", [
  {
    clause: "2",
    op: "add",
    anchor: "177",
    label: "177.01",
    marginalNote: "Calculation of hours of work — flight attendants",
    instruction:
      "The Canada Labour Code is amended by adding the following after section 177: DIVISION I.01 Flight Attendants — Calculation of hours of work.",
    text: "177.01 (1) For the purposes of section 169, in calculating the time worked in a day, a week or a pay period for which an employee who is a flight attendant is to be paid, the employer must include the time that the employee (a) spends carrying out all pre-flight and post-flight duties relating to aircraft security and passenger service, including assisting with embarking and disembarking and pre-flight cabin and passenger safety checks; (b) spends completing mandatory training programs; and (c) is in the work place, within the meaning of section 122, at the call of the employer and at the disposal of the employer, including during a flight delay, whether or not the delay is within the employer's control. (2) An employer must pay to each employee who is a flight attendant a wage at a rate not less than the employee's regular rate of wages for the work described in subsection (1).",
  },
]);

const C250_DELTAS = [C250_CLC];

// ─────────────────────────────────────────────────────────────────────────────
// C-251 — An Act to amend the Customs Act and the Customs Tariff (2 Acts)
// ─────────────────────────────────────────────────────────────────────────────
const C251_CUSTOMS_ACT = buildDelta(
  "customs-act",
  "Customs Act",
  "R.S.C., 1985, c. 1 (2nd Supp.)",
  [
    {
      clause: "1",
      op: "amend",
      anchor: "101",
      label: "101(2)",
      marginalNote: "Designated country or area or listed entity — detention",
      instruction:
        "Section 101 of the Customs Act is renumbered as subsection 101(1) and is amended by adding subsection (2).",
      text: "(2) In respect of goods referred to in subsection 136.1(2) of the Customs Tariff, the officer shall detain the goods until the officer is satisfied that the goods are not goods the importation of which is prohibited by section 136 of the Customs Tariff.",
    },
  ],
);

const C251_CUSTOMS_TARIFF = buildDelta(
  "customs-tariff",
  "Customs Tariff",
  "S.C. 1997, c. 36",
  [
    {
      clause: "2",
      op: "add",
      anchor: "132(1)",
      label: "132(1)(m.1)",
      marginalNote: "Regulations — supply chain tracing and diligence",
      instruction: "Subsection 132(1) of the Customs Tariff is amended by adding the following after paragraph (m).",
      text: "(m.1) for the purposes of section 136.1, regulating (i) the supply chain tracing to be performed and supply management measures to be taken, (ii) the procedure and time limits for the certification required, (iii) the diligence required of importers, and (iv) the information to be provided, the time limits for providing it and the manner in which it is to be provided;",
    },
    {
      clause: "3",
      op: "add",
      anchor: "136",
      label: "136.1",
      marginalNote: "Definitions; prohibited imports — presumption; rebuttable presumption",
      instruction: "The Act is amended by adding the following after section 136: Definitions.",
      text: "136.1 (1) In this section and in section 136.2, child labour and forced labour have the same meaning as in section 2 of the Fighting Against Forced Labour and Child Labour in Supply Chains Act, and entity has the same meaning as in section 2 of the Special Economic Measures Act. (2) For the purposes of section 136, goods that are mined, manufactured or produced wholly or in part in a country or area designated under section 136.2, or by an entity listed under subsection 136.3(1), are deemed to be goods of tariff item No. 9897.00.00 (goods mined, manufactured or produced wholly or in part by forced labour or child labour). (3) The presumption is rebutted if the importer demonstrates to a customs officer that they have performed the prescribed supply chain monitoring and supply management measures, provides any prescribed certification or information, demonstrates that they have exercised all prescribed due diligence, and the officer is satisfied the goods are not goods of that tariff item.",
    },
    {
      clause: "136.2",
      op: "add",
      anchor: "136",
      label: "136.2",
      marginalNote: "Designation — country or area",
      instruction: "Added after section 136: Designation — country or area.",
      text: "136.2 The Governor in Council may, by order, designate a country or area as a subject of concern if, on the recommendation of the Minister of Public Safety and Emergency Preparedness made after consultation with the Minister of Labour, the Governor in Council is satisfied that there are reasonable grounds to believe that, in that country or area, goods are mined, manufactured or produced wholly or in part by forced labour or child labour.",
    },
    {
      clause: "136.3",
      op: "add",
      anchor: "136",
      label: "136.3",
      marginalNote: "Establishment of list of entities",
      instruction: "Added after section 136: Establishment of list.",
      text: "136.3 (1) The Governor in Council may, by order, establish a list on which the name of any entity may be placed if there are reasonable grounds to believe that the entity mines, manufactures or produces goods wholly or in part using forced labour or child labour. (2) The Minister of Public Safety and Emergency Preparedness may amend the list. (3) Five years after an entity is listed and every five years after, the Minister must decide whether there are still reasonable grounds for listing the entity.",
    },
  ],
);

const C251_DELTAS = [C251_CUSTOMS_ACT, C251_CUSTOMS_TARIFF];

// ─────────────────────────────────────────────────────────────────────────────
// C-259 — Fair Representation Act (amends the Canada Labour Code)
// ─────────────────────────────────────────────────────────────────────────────
const C259_CLC = buildDelta("canada-labour-code", "Canada Labour Code", "R.S.C., 1985, c. L-2", [
  {
    clause: "2",
    op: "replace",
    anchor: "25(1)",
    label: "25(1)",
    marginalNote: "Where certification prohibited",
    instruction: "Subsection 25(1) of the Canada Labour Code is replaced by the following.",
    text: "25 (1) Notwithstanding anything in this Part, the Board shall not certify a trade union as the bargaining agent for any unit, and any collective agreement that applies to such employees shall be deemed not to be a collective agreement for the purposes of this Part, if the Board is satisfied that the trade union is dominated or influenced by an employer or a person acting on behalf of an employer, within the meaning of subsection 94(1.1).",
  },
  {
    clause: "3",
    op: "amend",
    anchor: "28",
    label: "28(d)",
    marginalNote: "Certification — independence and election requirement",
    instruction: "Section 28 of the Act is amended by adding paragraph (d) after paragraph (c).",
    text: "(d) is satisfied that the trade union is not dominated or influenced by an employer or a person acting on behalf of an employer, within the meaning of subsection 94(1.1), and is governed by members who are elected by employees in the unit that the trade union proposes to represent as bargaining agent.",
  },
  {
    clause: "4",
    op: "add",
    anchor: "40",
    label: "40.1",
    marginalNote: "Application where employer domination or influence",
    instruction: "The Act is amended by adding the following after section 40: Application where employer domination or influence.",
    text: "40.1 (1) If a trade union has been certified as bargaining agent, any group of employees who claim that the trade union is dominated or influenced by an employer, within the meaning of subsection 94(1.1), may at any time apply to the Board for an order revoking the certification. (2) The Board may hold an inquiry on its own initiative, but must do so if at least 25% of the employees in the unit so apply. (3) Except with the Board's consent, no such application may be made during a strike or lockout. (4) If the Board is satisfied the trade union is dominated or influenced by an employer, it shall, by order, revoke the certification.",
  },
  {
    clause: "5",
    op: "replace",
    anchor: "41(1)",
    label: "41(1)",
    marginalNote: "Revocation of certification of a council of trade unions",
    instruction: "Subsection 41(1) of the Act is replaced by the following.",
    text: "41 (1) If a council of trade unions has been certified as bargaining agent, in addition to circumstances under section 38 or subsection 40(1) or 40.1(1), any employee, the employer, or a trade union forming part of the council may apply to the Board for revocation of the certification on the ground that the council no longer meets the requirements for certification.",
  },
  {
    clause: "6",
    op: "replace",
    anchor: "42",
    label: "42",
    marginalNote: "Effect of revocation or declaration",
    instruction: "The portion of section 42 of the Act before paragraph (a) is replaced by the following.",
    text: "42 If the Board makes an order under section 39, subsection 40(2) or 40.1(4) or section 41 revoking the certification of a trade union or council of trade unions, or declaring that a trade union is not entitled to represent the employees in a bargaining unit,",
  },
  {
    clause: "7",
    op: "replace",
    anchor: "94(1)",
    label: "94(1) / 94(1.1)",
    marginalNote: "Prohibition on employer domination or influence",
    instruction: "Subsection 94(1) of the Act is replaced, and subsection (1.1) is added.",
    text: "94 (1) No employer or person acting on behalf of an employer shall dominate or influence a trade union. (1.1) An employer or a person acting on behalf of an employer dominates or influences a trade union if they, directly or indirectly, (a) participate in or interfere with the formation or administration of a trade union or the representation of employees by a trade union; or (b) contribute financial or other support to a trade union.",
  },
  {
    clause: "8",
    op: "add",
    anchor: "100",
    label: "100.01",
    marginalNote: "Offence — domination or influence",
    instruction: "The Act is amended by adding the following after section 100: Prohibition against domination or influence.",
    text: "100.01 Every employer who contravenes subsection 94(1) is guilty of an offence and liable on summary conviction to a fine not exceeding $100,000.",
  },
  {
    clause: "9",
    op: "amend",
    anchor: "111.01(1)",
    label: "111.01(1)",
    marginalNote: "Administrative monetary penalties",
    instruction: "The portion of subsection 111.01(1) of the Act before paragraph (b) is replaced by the following.",
    text: "111.01 (1) The Governor in Council may make regulations establishing an administrative monetary penalties scheme to promote compliance with subsections 94(1), (4) and (6), including regulations (a) designating as a violation the contravention of subsection 94(1), (4) or (6);",
  },
]);

const C259_DELTAS = [C259_CLC];

// ─────────────────────────────────────────────────────────────────────────────
// Export — one entry per bill (billId matches server/data/bills.json, session 45-1)
// ─────────────────────────────────────────────────────────────────────────────
export interface EvalBill {
  billId: string;
  billNumber: string;
  title: string;
  delta: ReturnType<typeof deltaRecord>;
  approval: ReturnType<typeof approvalRecord>;
}

const make = (billId: string, billNumber: string, title: string, deltas: Delta[]): EvalBill => ({
  billId,
  billNumber,
  title,
  delta: deltaRecord(billId, deltas),
  approval: approvalRecord(billId, deltas),
});

export const EVAL_BILLS: EvalBill[] = [
  make(
    "bill-1778356773007-swaxf9",
    "C-273",
    "An Act to amend the Feeds Act, the Fertilizers Act, the Seeds Act, the Pest Control Products Act and the Food and Drugs Act",
    C273_DELTAS,
  ),
  make("bill-13589584", "C-233", "An Act to amend the Export and Import Permits Act", C233_DELTAS),
  make("bill-13632066", "C-250", "Flight Attendants' Remuneration Act", C250_DELTAS),
  make(
    "bill-13569694",
    "C-251",
    "An Act to amend the Customs Act and the Customs Tariff (forced labour and child labour)",
    C251_DELTAS,
  ),
  make("bill-13854949", "C-259", "Fair Representation Act", C259_DELTAS),
];
