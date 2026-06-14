/**
 * EVAL client fixtures — the 7 real companies, INPUT HALF ONLY.
 *
 * Each record is the lawyer gold profile's input fields (Industry / Description /
 * Policies / Operations) verbatim, MINUS the answer half (the "Recent Bill
 * affecting the client" pairing, the "Impact assessment", and the "BCF's
 * Services" pitch — those live in eval/gold/profiles.json, which no server/ code
 * imports). The `Client` type has no bill field, so the client→bill pairing is
 * structurally un-leakable here; the stage-3 scan must REDISCOVER it.
 *
 * Faithfulness notes (so the eval grades the same input the lawyer reasoned over):
 *   - "Terms and conditions: N/A" → field omitted. "Policies: N/A" → field omitted
 *     (Nutrien, Bayer, Canneberges). The 4 clients whose Policies name their real
 *     statutory context keep it verbatim — that is legitimate scorer signal, not a
 *     leak (it describes the laws the client already lives under, never the bill or
 *     its effects).
 *   - Jurisdictions normalized from the gold's "Federal"/"Provincial" to the
 *     [city, "Canada"] house style, city taken from each profile's stated HQ.
 *   - French archetype scaffolding stripped from the names (#4/#6/#7); Bayer's
 *     "(acquired Monsanto)" note dropped from the name.
 *   - riskTolerance is not in the gold; assigned here (it shades brief urgency only).
 *
 * eval/seed-eval.ts upserts these into server/data/clients.json — running the
 * seeder is what populates the 7 into the committed file (single source of truth).
 */
import type { Client } from "../../src/types.js";

const CREATED_AT = "2026-06-13T12:00:00.000Z";

export const EVAL_CLIENTS: Client[] = [
  {
    id: "client-nutrien",
    name: "Nutrien Ltd.",
    industry:
      "Agricultural inputs and agribusiness industry (Global crop nutrition (fertilizers: potash, nitrogen, phosphate); Crop protection product distribution; Agricultural retail and farm services; Precision agriculture and digital farming technologies; Integrated agribusiness supply chain services).",
    jurisdictions: ["Saskatoon, SK", "Canada"],
    description:
      "Nutrien Ltd. is a Canadian-based global agricultural inputs company and one of the world's largest providers of crop nutrients and farming solutions. It operates across the agricultural value chain, supplying essential fertilizers, seed products, and crop protection solutions, while also delivering agronomic advisory services and digital agriculture tools. The company plays a central role in supporting global food production through its integrated network of production, distribution, and retail agricultural services.",
    operations:
      "Nutrien's Canadian operations include the production, procurement, and distribution of crop inputs such as potash, nitrogen, and phosphate fertilizers, as well as seeds and crop protection products. The company operates an extensive retail network serving farmers with agronomic consulting, precision agriculture tools, and crop management services. Its activities also include supply chain logistics, fertilizer manufacturing, data-driven farming technologies, and field-level agronomic support aimed at improving productivity, efficiency, and sustainable agricultural practices.",
    riskTolerance: "medium",
    createdAt: CREATED_AT,
  },
  {
    id: "client-bayer",
    name: "Bayer Inc.",
    industry:
      "Agricultural biotechnology and agrochemical industry (Genetically modified seeds and plant traits; Crop protection products (herbicides, fungicides, insecticides); Agricultural biotechnology and data-driven farming technologies).",
    jurisdictions: ["Mississauga, ON", "Canada"],
    description:
      "Bayer is a multinational life sciences company operating in both the healthcare and agriculture sectors. In agriculture, its Crop Science division focuses on improving agricultural productivity through seed innovation, biotechnology, and chemical crop protection products. The company develops and commercializes genetically modified crop traits, seeds, and crop protection solutions designed to increase yields, manage pests and weeds, and support modern farming practices.",
    operations:
      "Bayer's Canadian agricultural operations include the development, testing, and commercialization of seeds and crop protection products, as well as digital and precision agriculture technologies. Activities involve biotechnology and trait research, seed development and distribution, herbicide and pesticide product management, field trials, agronomic advisory services, and data-driven farming tools aimed at improving productivity, sustainability, and farm efficiency.",
    riskTolerance: "medium",
    createdAt: CREATED_AT,
  },
  {
    id: "client-canneberges",
    name: "Canneberges Bieler Inc.",
    industry:
      "Agricultural production and agri-food industry (Specialty crop farming (horticulture); Cranberry cultivation and production; Post-harvest processing and agri-food supply chain integration; Primary agricultural production (soft fruit sector)).",
    jurisdictions: ["Québec", "Canada"],
    description:
      "Canneberges Bieler Inc. is a Québec-based agricultural producer and one of Canada's leading cranberry farming companies. Established in the mid-1980s, it specializes in large-scale cranberry cultivation and operates multiple production sites. The company manages the full cultivation cycle, from bog development and field preparation to harvesting, storage, and shipment, supplying cranberries to major processors and cooperatives such as Ocean Spray. Its operations are supported by agronomic expertise and a focus on sustainable agricultural practices and long-term land stewardship.",
    operations:
      "Canneberges Bieler Inc.'s operations include the cultivation of cranberries in engineered bog systems, seasonal harvesting activities such as flooding and berry collection, and post-harvest handling including storage and transport. The company also engages in agricultural land management and development, supply chain coordination with processors and distributors, and agronomic practices aimed at improving crop yield, operational efficiency, and environmental sustainability in cranberry production.",
    riskTolerance: "medium",
    createdAt: CREATED_AT,
  },
  {
    id: "client-gdms-canada",
    name: "General Dynamics Mission Systems–Canada",
    industry:
      "Defence technology and aerospace industry (Military communications systems; Command, control, communications, computers, intelligence, surveillance and reconnaissance (C4ISR) solutions; Cybersecurity systems; Naval and land defence electronics; Tactical data networks; Intelligence and mission systems integration; Defence software and secure communications technologies).",
    jurisdictions: ["Montreal, QC", "Canada"],
    description:
      "General Dynamics Mission Systems–Canada (GDMS-C) is a Canadian defence technology company headquartered in Montreal, Quebec, and a subsidiary of General Dynamics Corporation. The company develops advanced communications, command-and-control, intelligence, cybersecurity, and mission-critical technologies for the Canadian Armed Forces, allied militaries, and government agencies. Its products and services support military operations, national security objectives, and defence modernization programs in Canada and internationally.",
    policies:
      "Subject to Canadian export-control laws, defence procurement requirements, national security regulations, and international trade compliance frameworks governing military goods and technologies.",
    operations:
      "GDMS-C's Canadian operations include the design, development, manufacturing, integration, and export of defence-related technologies and systems. The company produces secure communications equipment, tactical radios, naval combat management systems, intelligence platforms, cybersecurity solutions, and command-and-control technologies. It also participates in defence research and development, systems engineering, military modernization projects, and cross-border defence supply chains involving Canadian and allied defence partners.",
    riskTolerance: "low",
    createdAt: CREATED_AT,
  },
  {
    id: "client-westjet",
    name: "WestJet Airlines Ltd.",
    industry:
      "Commercial aviation and air transportation industry (Passenger air transportation; Domestic and international airline services; Flight operations; Flight attendant and cabin crew services; Aviation safety and training; Tourism and travel services).",
    jurisdictions: ["Calgary, AB", "Canada"],
    description:
      "WestJet Airlines Ltd. is one of Canada's largest airlines and operates under federal jurisdiction as an air carrier. Headquartered in Calgary, Alberta, the company provides scheduled passenger services throughout Canada, the United States, Europe, Mexico, Central America, and the Caribbean. WestJet employs thousands of flight attendants, pilots, maintenance personnel, and customer service employees and is subject to the Canada Labour Code and federal labour standards governing airline operations.",
    policies:
      "Subject to the Canada Labour Code, occupational health and safety requirements, collective agreements, aviation labour regulations, and Canadian aviation safety regulations.",
    operations:
      "WestJet's operations include passenger air transportation, flight operations, cabin crew management, aircraft maintenance, aviation safety compliance, flight attendant training, customer service, baggage handling, and international route management. Flight attendants perform numerous operational and safety-related duties before, during, and after flights, including boarding assistance, safety demonstrations, cabin inspections, emergency preparedness activities, passenger service, deplaning assistance, and mandatory recurrent training programs.",
    riskTolerance: "medium",
    createdAt: CREATED_AT,
  },
  {
    id: "client-dollarama",
    name: "Dollarama Inc.",
    industry:
      "Retail and consumer goods industry (Discount retail; Household products; Seasonal merchandise; Food and confectionery products; Health and beauty products; General merchandise; Global sourcing and supply chain management).",
    jurisdictions: ["Montreal, QC", "Canada"],
    description:
      "Dollarama Inc. is a Canadian discount retail chain headquartered in Montreal, Quebec. The company operates thousands of stores across Canada and offers a wide range of low-cost consumer products, including household goods, food items, cleaning products, stationery, seasonal merchandise, toys, and personal care products. A significant portion of its merchandise is sourced through complex international supply chains involving manufacturers and suppliers located in various regions around the world.",
    policies:
      "Subject to the Customs Act, Customs Tariff, Fighting Against Forced Labour and Child Labour in Supply Chains Act, consumer protection legislation, import regulations, and corporate supply chain compliance policies.",
    operations:
      "Dollarama's operations include the sourcing, procurement, importation, distribution, warehousing, and retail sale of consumer products. The company relies extensively on global supply chains to obtain merchandise from foreign manufacturers and suppliers. Its activities include supplier management, logistics coordination, customs compliance, inventory management, and retail distribution throughout Canada.",
    riskTolerance: "medium",
    createdAt: CREATED_AT,
  },
  {
    id: "client-air-canada",
    name: "Air Canada",
    industry:
      "Commercial aviation and air transportation industry (Passenger air transportation; Cargo transportation; Flight operations; Ground services; Customer service operations; Aviation maintenance and support services).",
    jurisdictions: ["Montreal, QC", "Canada"],
    description:
      "Air Canada is Canada's largest airline and flag carrier. Headquartered in Montreal, Quebec, the company operates domestic and international passenger and cargo services across six continents. As an employer in the federally regulated transportation sector, Air Canada is governed by the Canada Labour Code for labour relations matters. The company employs tens of thousands of workers, including flight attendants, pilots, mechanics, baggage handlers, customer service agents, and administrative personnel represented by various unions or bargaining agents.",
    policies:
      "Subject to the Canada Labour Code, Canada Industrial Relations Board (CIRB) requirements, collective bargaining agreements, occupational health and safety regulations, and federal labour relations legislation.",
    operations:
      "Air Canada's operations include passenger transportation, cargo services, airport operations, maintenance and engineering services, flight operations, customer service activities, and corporate administration. The company manages a large workforce across numerous bargaining units and works regularly with unions and employee representatives on collective bargaining, workplace policies, and labour relations matters.",
    riskTolerance: "low",
    createdAt: CREATED_AT,
  },
];
