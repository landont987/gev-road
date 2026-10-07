// Broadcastify Calls groups for the Phoenix metro, as {system id}-{talkgroup}.
// Every id and name below was read from the Maricopa County coverage list
// (broadcastify.com/calls/coverage/ctid/?ctid=100&tagId=2) on 2026-10-06.
// Only channels that are in the clear are listed; Phoenix PD B, C ("Hot") and D
// decks are encrypted and left out on purpose.
//   2508 = Regional Wireless Cooperative (RWC)
//   3759 = Arizona Wireless Integrated Network System (AZ WINS)
//   2082 = TOPAZ Regional Wireless Cooperative (TRWC)

export const CALL_GROUPS = {
  '2508-2811': "A02 200 Black Mt Prec",
  '2508-2996': "A04 400 South Mt Prec",
  '2508-2995': "A05 500 Central City Prec",
  '2508-2994': "A06 600 Desert Horizon Prec",
  '2508-2993': "A07 700 Mt View Prec",
  '2508-2992': "A08 800 Maryvale Estralla Prec",
  '2508-2991': "A09 900 Cactus Park Prec",
  '2508-1795': "K1 - Alarm VHF-Patched Ch 1",
  '2508-1753': "K2",
  '2508-1615': "K6 - FDCOM 6 - North",
  '2508-1614': "K7 - FDCOM 7 - East",
  '2508-1613': "K8 - FDCOM 8 - South",
  '2508-1612': "K9 - FDCOM 9 - West",
  '3759-1055': "DPS District 5 - Metro Central - Phoenix (Simulcast)",
  '3759-1058': "DPS District 13 - Metro East - Phoenix (Simulcast)",
  '3759-1059': "DPS District 14 - Metro West - Phoenix (Simulcast)",
  '2508-2498': "A02 Patrol A",
  '2508-2485': "B02 Patrol B",
  '2082-3066': "C3 Mesa",
  '2082-3067': "C4 Gilbert, QC, Superstition",
  '2082-3068': "C5 Major Incident",
  '2508-4499': "A01 Dispatch",
  '2508-2987': "Sky Harbor PD",
  '3759-1103': "ADOT Phoenix Traffic Ops Center",
};

/** Ready-made sets, one tap each. */
export const CALL_PACKS = [
  { id: "phx-pd", name: "Phoenix Police dispatch (all precincts)", groups: ["2508-2811", "2508-2996", "2508-2995", "2508-2994", "2508-2993", "2508-2992", "2508-2991"] },
  { id: "phx-fire", name: "Phoenix Fire dispatch", groups: ["2508-1795", "2508-1753", "2508-1615", "2508-1614", "2508-1613", "2508-1612"] },
  { id: "dps", name: "DPS Highway Patrol: Phoenix freeways", groups: ["3759-1055", "3759-1058", "3759-1059"] },
  { id: "east", name: "Chandler Police + Mesa/Gilbert Fire", groups: ["2508-2498", "2508-2485", "2082-3066", "2082-3067", "2082-3068"] },
  { id: "west", name: "Avondale Police + DPS Metro West", groups: ["2508-4499", "3759-1059"] },
  { id: "airport", name: "Sky Harbor Police + ADOT traffic ops", groups: ["2508-2987", "3759-1103"] },
];

export const groupName = (id) => CALL_GROUPS[id] || id;
