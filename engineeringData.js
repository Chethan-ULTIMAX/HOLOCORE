/**
 * HOLOCORE — engineeringData.js
 * -----------------------------------------------------------------------------
 * Structured engineering knowledge base.
 *
 * Two exports:
 *   MODEL_LIBRARY — catalogue of every assembly HOLOCORE can place in the scene.
 *   COMPONENTS    — per-model knowledge for every selectable component.
 *
 * Design notes
 *  - Every procedurally built part in modelFactory.js carries a `partId`. The
 *    validation script (tools/validate.js) asserts that geometry and knowledge
 *    stay in sync in both directions, so the inspector can never show generic
 *    filler for a real part.
 *  - Numeric values are *representative reference figures* for that class of
 *    hardware (typical order of magnitude), not vendor datasheets. The UI
 *    labels them as reference data.
 *  - `relations` form a directed graph used by the inspector ("related
 *    components"), the inspector's system view, and the assistant when asked
 *    about dependencies or failure cascades.
 */

export const DATA_PROVENANCE = {
  label: "Reference engineering data",
  note:
    "Figures are representative values for this class of hardware, compiled for " +
    "education. They are not vendor datasheets and should not be used for design."
};

/* ------------------------------------------------------------------------- */
/* MODEL LIBRARY                                                             */
/* ------------------------------------------------------------------------- */

export const MODEL_LIBRARY = [
  {
    id: "launchVehicle",
    name: "Astra-9 Launch Vehicle",
    short: "Astra-9",
    category: "Aerospace",
    glyph: "◭",
    accent: "#42c6ff",
    blurb: "Two-stage orbital launcher: cryogenic oxidiser, kerosene fuel, gimballed engine.",
    summary:
      "A two-stage launch vehicle that stacks payload, propellant tanks and propulsion " +
      "into one load-bearing column. The tanks carry their own pressure, so the structure " +
      "is thin-walled and the whole vehicle is a pressure-stabilised shell.",
    systemOverview:
      "The flight computer steers by gimballing the main engine while the tanks feed " +
      "turbopumps that raise propellant pressure far above tank pressure. Every subsystem " +
      "shares one goal: convert chemical energy into a controlled thrust vector while the " +
      "structure survives aerodynamic and inertial loads.",
    scale: 1,
    keywords: ["rocket", "launch", "aerospace", "propulsion", "space"]
  },
  {
    id: "turbojet",
    name: "Single-Spool Turbojet",
    short: "Turbojet",
    category: "Aerospace",
    glyph: "❋",
    accent: "#7cc4ff",
    blurb: "Air-breathing gas turbine: compress, burn, expand, exhaust.",
    summary:
      "A turbojet is a Brayton-cycle engine that turns a small pressure rise into a large " +
      "one by burning fuel inside the airflow. The turbine extracts just enough work to " +
      "drive the compressor; the rest leaves as high-velocity exhaust.",
    systemOverview:
      "Air passes compressor stages, gains pressure and temperature, burns at constant " +
      "pressure in the combustor, then expands through turbine stages that spin a common " +
      "shaft. Thrust comes from the momentum change of the exhaust stream, not from the " +
      "turbine.",
    scale: 1,
    keywords: ["jet", "turbine", "gas turbine", "propulsion", "aircraft"]
  },
  {
    id: "inlineEngine",
    name: "Inline-4 Automotive Engine",
    short: "Inline-4",
    category: "Automotive",
    glyph: "◱",
    accent: "#ffc46b",
    blurb: "Four-stroke reciprocating engine with DOHC valve train.",
    summary:
      "A water-cooled four-cylinder spark-ignition engine. Each cylinder runs the same " +
      "four-stroke cycle offset by 180° of crank rotation, so one power stroke is always " +
      "in progress and the crankshaft receives torque almost continuously.",
    systemOverview:
      "Air and fuel enter through the head, combustion pushes the piston down a bore, the " +
      "connecting rod converts that translation into rotation, and the crankshaft delivers " +
      "torque to the driveline. The camshafts are mechanically slaved to the crankshaft so " +
      "valve timing is always correct.",
    scale: 1,
    keywords: ["car", "engine", "piston", "automotive", "combustion"]
  },
  {
    id: "gearTrain",
    name: "Spur Gear Train",
    short: "Gear Train",
    category: "Mechanical",
    glyph: "⚙",
    accent: "#b7a1ff",
    blurb: "Three-stage speed reduction with shaft, bearing and lubrication hardware.",
    summary:
      "A gear train trades speed for torque. Each meshing pair multiplies torque by its " +
      "ratio and divides speed by the same factor, while the total ratio is the product of " +
      "the individual stages.",
    systemOverview:
      "Power enters on the input shaft, moves through an idler that reverses direction, and " +
      "leaves at high torque. Bearings take the radial and axial loads created by the " +
      "helical-tooth contact forces, and an oil circuit removes the heat those contacts make.",
    scale: 1,
    keywords: ["gear", "mechanical", "transmission", "torque", "machine"]
  },
  {
    id: "robotArm",
    name: "6-Axis Industrial Robot",
    short: "Robot Arm",
    category: "Robotics",
    glyph: "⌬",
    accent: "#5cf2c1",
    blurb: "Six-revolution articulated arm with servo drives and a two-finger gripper.",
    summary:
      "An articulated robot with six independent revolute joints. Six degrees of freedom " +
      "are the minimum needed to place an object at an arbitrary position *and* " +
      "orientation inside the work envelope.",
    systemOverview:
      "A controller solves inverse kinematics for the tool tip, then sends position set " +
      "points to six servo drives. Harmonic drives remove backlash so the tip arrives where " +
      "the controller predicts, and the gripper closes the loop on the workpiece itself.",
    scale: 1,
    keywords: ["robot", "arm", "robotics", "servo", "automation"]
  },
  {
    id: "controlPCB",
    name: "Control Board (PCB)",
    short: "PCB",
    category: "Electronics",
    glyph: "⊞",
    accent: "#4ee6a8",
    blurb: "Microcontroller board with power stage, crystal clock and I/O.",
    summary:
      "A four-layer printed circuit board that supervises the machine. Copper planes " +
      "distribute power and ground, a microcontroller runs firmware, and a switching " +
      "regulator makes the low voltages that logic needs from the 12 V rail.",
    systemOverview:
      "Power enters through a connector, is filtered and regulated, and is distributed on " +
      "copper planes. The microcontroller executes code against a crystal timebase, reads " +
      "sensors, and drives outputs. Every high-current loop is kept physically small so it " +
      "does not radiate noise into the analogue side.",
    scale: 1,
    keywords: ["pcb", "circuit", "electronics", "microcontroller", "board"]
  },
  {
    id: "cpuPackage",
    name: "CPU Package",
    short: "CPU",
    category: "Computing",
    glyph: "▦",
    accent: "#8fb4ff",
    blurb: "Silicon die on an organic substrate under an integrated heat spreader.",
    summary:
      "A desktop processor package: the silicon die is flipped onto an organic substrate, " +
      "bonded to an integrated heat spreader, and contacted through a land-grid array. It " +
      "is a mechanical, thermal and electrical system at the same time.",
    systemOverview:
      "Power arrives on hundreds of lands, is decoupled locally, and is switched by " +
      "billions of transistors. Almost all of that power becomes heat, which must cross " +
      "two thermal interfaces before it can reach a cooler.",
    scale: 1,
    keywords: ["cpu", "computer", "hardware", "silicon", "chip"]
  },
  {
    id: "windTurbine",
    name: "Utility Wind Turbine",
    short: "Wind Turbine",
    category: "Industrial",
    glyph: "✧",
    accent: "#6fe0ff",
    blurb: "Three-blade horizontal-axis turbine with pitch, yaw and gearbox.",
    summary:
      "A horizontal-axis wind turbine captures kinetic energy from moving air with a " +
      "three-blade rotor, then converts low-speed high-torque rotation into grid-frequency " +
      "electricity.",
    systemOverview:
      "Blades convert wind into rotor torque, the gearbox raises shaft speed by roughly a " +
      "hundredfold, and the generator produces electrical power. Pitch and yaw control keep " +
      "the rotor facing the wind and limit loads in storms.",
    scale: 1,
    keywords: ["wind", "turbine", "energy", "industrial", "renewable"]
  }
];

/* ------------------------------------------------------------------------- */
/* COMPONENT KNOWLEDGE                                                       */
/* ------------------------------------------------------------------------- */

export const COMPONENTS = {
  /* ===================================================================== */
  launchVehicle: {
    "payload-fairing": {
      name: "Payload Fairing",
      short: "Aerodynamic shell protecting the payload during ascent",
      category: "Primary structure",
      function:
        "Encloses the payload and keeps it inside a clean, controlled environment until the " +
        "vehicle is above the dense atmosphere.",
      principle:
        "Two composite half-shells are joined by a longitudinal seam and a separation ring. " +
        "Acoustic blankets absorb engine noise and vent ports equalise pressure as the " +
        "vehicle climbs. At a set altitude the seam is cut by pyrotechnic or pneumatic " +
        "pushers and the halves fall away on hinges and springs.",
      role:
        "It is the top of the aerodynamic stack. It carries the payload, completes the " +
        "vehicle's outer mould line, and is the first structure to be jettisoned.",
      specs: [
        { label: "Diameter", value: "5.2 m" },
        { label: "Length", value: "13.8 m" },
        { label: "Mass", value: "~1,900 kg" },
        { label: "Skin", value: "Carbon-fibre / aluminium honeycomb" },
        { label: "Separation altitude", value: "≈ 110 km" }
      ],
      materials: ["Carbon-fibre composite", "Aluminium honeycomb core", "Cork ablative"],
      relations: [
        { target: "payload-adapter", label: "Bolts to the payload adapter at its base" },
        { target: "avionics-bay", label: "Receives separation commands from the flight computer" }
      ],
      education:
        "Think of it as a shipping crate that also has to be an aeroplane's nose. Once the " +
        "air thins out it is dead weight, so it is thrown away as early as safely possible.",
      failureMode:
        "A failed separation stranding the fairing halves costs the mission: the extra mass " +
        "and drag mean the upper stage cannot reach orbital velocity.",
      facts: ["Fairing halves are recovered for reuse by some operators using parafoils."],
      keywords: ["fairing", "nose", "payload", "shell", "cover"]
    },
    "payload-adapter": {
      name: "Payload Adapter",
      short: "Conical interface ring between payload and upper stage",
      category: "Interface structure",
      function:
        "Transfers all payload loads into the vehicle and provides the mechanical and " +
        "electrical interface between the satellite and the launcher.",
      principle:
        "A stiff conical shell spreads a point-loaded satellite mount over the full tank " +
        "dome. A clamp band or frangible nut holds the spacecraft down until separation, " +
        "when a redundant release lets springs push it clear.",
      role:
        "It is the structural bottleneck of the whole mission: payload mass, stiffness and " +
        "separation reliability all pass through this one ring.",
      specs: [
        { label: "Interface diameter", value: "1,660 mm" },
        { label: "Mass", value: "~120 kg" },
        { label: "Axial stiffness", value: "> 1.2 × 10⁷ N/m" },
        { label: "Release", value: "Clamp band, redundant initiators" }
      ],
      materials: ["Aluminium-lithium alloy", "Titanium fasteners"],
      relations: [
        { target: "payload-fairing", label: "Carries the fairing and its payload" },
        { target: "lox-tank", label: "Bolts directly onto the oxidiser tank dome" },
        { target: "avionics-bay", label: "Routes payload telemetry through the avionics bay" }
      ],
      education:
        "Its cone shape is a load-spreading trick: a small ring at the top and a big ring at " +
        "the bottom means stress is spread out instead of concentrated.",
      failureMode:
        "A stuck clamp band leaves the satellite attached to a spent stage — total mission loss.",
      facts: [],
      keywords: ["adapter", "ring", "interface", "payload mount"]
    },
    "avionics-bay": {
      name: "Avionics Bay",
      short: "Flight computers, inertial navigation and telemetry",
      category: "Guidance & control",
      function:
        "Runs the flight sequence, measures the vehicle's attitude and position, and steers " +
        "it by commanding the engine gimbal and stage events.",
      principle:
        "Redundant flight computers vote on sensor data from ring-laser or fibre-optic gyros " +
        "and accelerometers. A control law compares measured attitude to the planned " +
        "trajectory and outputs gimbal angles many times per second.",
      role:
        "The navigation loop is what turns a rocket into a guided vehicle. Without it the " +
        "thrust vector is uncontrolled and the vehicle tumbles.",
      specs: [
        { label: "Control rate", value: "100 Hz" },
        { label: "Redundancy", value: "Triple flight computers" },
        { label: "Attitude sensors", value: "3 × IMU, star tracker on upper stage" },
        { label: "Power", value: "28 V DC bus, Li-ion battery" }
      ],
      materials: ["Aluminium chassis", "Radiation-tolerant electronics"],
      relations: [
        { target: "gimbal", label: "Commands gimbal actuators" },
        { target: "payload-adapter", label: "Controls payload separation" },
        { target: "turbopump", label: "Sequences turbopump start and shutdown" }
      ],
      education:
        "It is the vehicle's inner ear and brain. The gyros feel rotation; the computer " +
        "compares that to the plan and nudges the engine.",
      failureMode:
        "Loss of the guidance loop means loss of control authority; the flight termination " +
        "system destroys the vehicle to protect the range.",
      facts: ["Modern flight computers run the same class of processor as a car ECU."],
      keywords: ["avionics", "computer", "guidance", "navigation", "imu", "control"]
    },
    "lox-tank": {
      name: "Liquid Oxygen Tank",
      short: "Cryogenic oxidiser tank",
      category: "Propellant system",
      function:
        "Stores liquid oxygen at about −183 °C and delivers it to the engine at the flow " +
        "rate the turbopump demands.",
      principle:
        "The tank is a thin pressure-stabilised shell. Internal pressure — produced by " +
        "boil-off and a helium pressurisation system — gives the skin its stiffness and " +
        "pushes propellant to the pump inlet, preventing cavitation.",
      role:
        "Oxygen is 80 % of the propellant mass by mass flow in a kerolox engine, so this " +
        "tank dominates the vehicle's volume and mass budget.",
      specs: [
        { label: "Propellant", value: "LOX (−183 °C)" },
        { label: "Volume", value: "~280 m³" },
        { label: "Wall thickness", value: "4–6 mm aluminium-lithium" },
        { label: "Operating pressure", value: "≈ 350 kPa" },
        { label: "Insulation", value: "Cork / spray-on foam" }
      ],
      materials: ["Aluminium-lithium 2195", "Cork ablator", "Stainless plumbing"],
      relations: [
        { target: "fuel-tank", label: "Shares a common bulkhead with the fuel tank" },
        { target: "turbopump", label: "Supplies oxidiser to the pump inlet" },
        { target: "interstage", label: "Transfers thrust loads through to the interstage" }
      ],
      education:
        "Cryogenic tanks sweat and shrink. Engineers keep them pressurised so the metal " +
        "stays stiff like an unopened soda can rather than crushing like an empty one.",
      failureMode:
        "Loss of pressurisation collapses the thin wall under its own thrust loads; the " +
        "structure fails within seconds.",
      facts: ["LOX expands about 860× when it boils into gas at ambient pressure."],
      keywords: ["lox", "oxygen", "tank", "cryogenic", "propellant"]
    },
    "fuel-tank": {
      name: "Fuel Tank",
      short: "Kerosene (RP-1) tank",
      category: "Propellant system",
      function:
        "Stores the hydrocarbon fuel and supplies it to the turbopump at a pressure high " +
        "enough to keep the pump from cavitating.",
      principle:
        "A common bulkhead separates fuel from the colder oxidiser above. The bulkhead is " +
        "insulated on the LOX side so the fuel is not frozen, and it carries the pressure " +
        "difference between the two tanks.",
      role:
        "The fuel tank also carries part of the thrust path: engine loads travel up through " +
        "the skirt into this tank and then into the interstage.",
      specs: [
        { label: "Propellant", value: "RP-1 kerosene" },
        { label: "Volume", value: "~105 m³" },
        { label: "Operating pressure", value: "≈ 320 kPa" },
        { label: "Mixture ratio (O/F)", value: "2.36 by mass" },
        { label: "Bulkhead", value: "Common dome with cryogenic insulation" }
      ],
      materials: ["Aluminium-lithium", "Polyurethane foam insulation"],
      relations: [
        { target: "lox-tank", label: "Shares the common bulkhead" },
        { target: "turbopump", label: "Feeds the fuel turbopump stage" },
        { target: "thrust-chamber", label: "Supplied fuel becomes the coolant for the chamber" }
      ],
      education:
        "Kerosene is dense, which is why the fuel tank is small compared with the oxygen " +
        "tank even though far less oxygen is used by mass than air-breathing engines assume.",
      failureMode:
        "A fuel leak combined with an ignition source is catastrophic; tank pressure " +
        "monitoring trips an abort.",
      facts: ["RP-1 is a refined kerosene with very low sulphur to reduce coking."],
      keywords: ["fuel", "kerosene", "rp-1", "tank", "propellant"]
    },
    "first-stage-tank": {
      name: "First-Stage Propellant Tank",
      short: "Long cryogenic tank carrying the ascent propellant load",
      category: "Propellant system",
      function:
        "Holds the bulk of the first-stage propellant and carries the whole vehicle's " +
        "thrust and bending loads on the way up.",
      principle:
        "A pressure-stabilised aluminium-lithium shell with internal slosh baffles and a " +
        "spray-on foam insulation layer. The tank is pressurised to keep the thin skin " +
        "stiff, and its stringers carry the compressive load from the engines below to the " +
        "interstage above.",
      role:
        "It is the structural spine of the booster and 70 % of its dry mass. Thrust travels " +
        "up the barrel to the interstage, so a buckling failure here ends the flight.",
      specs: [
        { label: "Propellant", value: "LOX / RP-1, sub-cooled" },
        { label: "Length", value: "41 m" },
        { label: "Diameter", value: "3.7 m" },
        { label: "Wall thickness", value: "4.7 mm" },
        { label: "Buckling margin", value: "> 1.4 at max-q" }
      ],
      materials: ["Aluminium-lithium 2195", "Spray-on foam insulation", "Slosh baffles"],
      relations: [
        { target: "thrust-structure", label: "Receives thrust through the engine skirt" },
        { target: "interstage", label: "Passes load into the interstage" },
        { target: "turbopump", label: "Feeds propellant to the turbopumps" }
      ],
      education:
        "A rocket tank is not a heavy drum — it is a thin balloon that holds its shape " +
        "because it is pressurised. That is how a 41 m tank can weigh less than a car.",
      failureMode:
        "Loss of internal pressure causes the barrel to buckle; the vehicle breaks up within " +
        "a second.",
      facts: [
        "Sub-cooling the propellant increases density, so more mass fits in the same tank.",
        "The tank is the primary load path, not just a container."
      ],
      keywords: ["first stage", "booster", "tank", "propellant", "barrel"]
    },
    interstage: {
      name: "Interstage & Stage Adapter",
      short: "Structural section between first and second stage",
      category: "Primary structure",
      function:
        "Carries second-stage loads into the first-stage tanks, houses the separation " +
        "system, and protects the upper-stage engine bell before separation.",
      principle:
        "A stiff composite cylinder takes compression plus bending from the upper stage. " +
        "Pneumatic pushers or a separation motor accelerate the two stages apart along the " +
        "thrust axis so they cannot re-contact.",
      role:
        "It is a sacrificial-looking but critical structure: it must be strong while " +
        "attached and must be completely out of the way one second later.",
      specs: [
        { label: "Diameter", value: "3.7 m" },
        { label: "Length", value: "5.2 m" },
        { label: "Material", value: "Carbon-fibre / aluminium honeycomb" },
        { label: "Separation", value: "4 × pneumatic pushers" }
      ],
      materials: ["Carbon-fibre composite", "Aluminium honeycomb"],
      relations: [
        { target: "fuel-tank", label: "Bolts onto the first-stage fuel tank" },
        { target: "payload-fairing", label: "Sits below the upper stage that carries the fairing" },
        { target: "avionics-bay", label: "Houses stage-separation sensors" }
      ],
      education:
        "Separation is a load case of its own: everything that holds the stages together " +
        "must release cleanly, on command, with no fragments left behind.",
      failureMode:
        "Partial separation causes the stages to collide and tumble; the mission is lost.",
      facts: [],
      keywords: ["interstage", "adapter", "separation", "stage"]
    },
    turbopump: {
      name: "Turbopump Assembly",
      short: "High-pressure pumps driven by a gas turbine",
      category: "Propulsion",
      function:
        "Raises liquid propellant from tank pressure (~3 bar) to chamber pressure " +
        "(~100 bar) so the engine can run at high thrust without enormous, heavy tanks.",
      principle:
        "Some of the propellant is burned in a preburner to spin a turbine that shares a " +
        "shaft with two centrifugal impellers — one for fuel, one for LOX. A rotor turning " +
        "at tens of thousands of RPM adds pressure energy to the flow before it reaches the " +
        "main injector.",
      role:
        "The pump is what makes a lightweight, high-pressure engine possible. It is also " +
        "the most stress-intensive machine on the vehicle.",
      specs: [
        { label: "Shaft speed", value: "≈ 36,000 rpm" },
        { label: "Flow rate", value: "≈ 900 kg/s total" },
        { label: "Discharge pressure", value: "≈ 11 MPa" },
        { label: "Turbine inlet temp.", value: "≈ 900 K" },
        { label: "Bearings", value: "Hydrostatic, propellant-lubricated" }
      ],
      materials: ["Inconel 718", "Titanium impellers", "Hydrostatic bearing liners"],
      relations: [
        { target: "lox-tank", label: "Draws LOX from the oxidiser tank" },
        { target: "fuel-tank", label: "Draws kerosene from the fuel tank" },
        { target: "thrust-chamber", label: "Delivers propellant at injection pressure" },
        { target: "avionics-bay", label: "Start and shutdown sequenced by flight computers" }
      ],
      education:
        "Why pump at all? A pressure-fed engine would need tanks with walls so thick they " +
        "would weigh more than the vehicle can lift. Pumps move the work into a small, " +
        "light machine instead.",
      failureMode:
        "Cavitation or bearing failure destroys the pump in milliseconds; the engine shuts " +
        "down and the stage is lost.",
      facts: [
        "The turbine is spun up by a helium start bottle before propellant ignition.",
        "Turbopump power can exceed 20 MW — more than a Formula 1 engine."
      ],
      keywords: ["turbopump", "pump", "turbine", "propellant", "impeller"]
    },
    "thrust-chamber": {
      name: "Thrust Chamber",
      short: "Combustion chamber and main injector",
      category: "Propulsion",
      function:
        "Mixes and burns propellants at high pressure to produce hot gas for the nozzle.",
      principle:
        "The injector breaks fuel and oxidiser into fine, intersecting jets so mixing " +
        "happens fast in a compact volume. Combustion temperature reaches ~3,500 K — far " +
        "above the melting point of the chamber wall — so fuel is circulated through " +
        "cooling channels in the wall before it is burned (regenerative cooling).",
      role:
        "All the chemical energy of the mission is released here. Chamber pressure directly " +
        "sets the thrust and the achievable specific impulse at sea level.",
      specs: [
        { label: "Chamber pressure", value: "≈ 9.7 MPa" },
        { label: "Thrust (sea level)", value: "≈ 845 kN" },
        { label: "Specific impulse", value: "282 s (SL) / 311 s (vac)" },
        { label: "Combustion temp.", value: "≈ 3,500 K" },
        { label: "Cooling", value: "Regenerative, fuel-side" }
      ],
      materials: ["Copper alloy liner (GRCop)", "Inconel structural jacket"],
      relations: [
        { target: "turbopump", label: "Receives propellant at injection pressure" },
        { target: "nozzle", label: "Exhausts into the nozzle for expansion" },
        { target: "gimbal", label: "Mounted on the gimbal bearing to vector thrust" },
        { target: "fuel-tank", label: "Fuel absorbs chamber heat before injection" }
      ],
      education:
        "The cooling trick is the clever part: the same kerosene that will burn inside the " +
        "chamber is first pushed through channels in the chamber wall to carry heat away.",
      failureMode:
        "A cooling-channel burn-through leads to rapid, unrecoverable engine failure.",
      facts: ["Peak heat flux in the throat exceeds that on a re-entering spacecraft."],
      keywords: ["chamber", "combustion", "injector", "engine", "thrust"]
    },
    nozzle: {
      name: "Nozzle Bell",
      short: "Supersonic expansion nozzle",
      category: "Propulsion",
      function:
        "Expands hot, high-pressure combustion gas to low pressure and high velocity, " +
        "converting thermal energy into thrust.",
      principle:
        "Downstream of the throat the flow is supersonic, so the duct must diverge to " +
        "accelerate it further — the opposite of a hose nozzle. A bell contour is used " +
        "because it is short and light while still delivering most of the thrust of an " +
        "ideal bell-shaped expansion.",
      role:
        "The nozzle is where pressure energy finally becomes momentum. Its exit area sets " +
        "how much expansion is possible at a given altitude.",
      specs: [
        { label: "Throat diameter", value: "≈ 0.31 m" },
        { label: "Exit diameter", value: "≈ 1.3 m" },
        { label: "Expansion ratio", value: "≈ 16 : 1" },
        { label: "Exit velocity", value: "≈ 3.0 km/s" },
        { label: "Cooling", value: "Regenerative tubes, upper section" }
      ],
      materials: ["Nickel superalloy tubes", "Copper throat insert", "Ceramic coating"],
      relations: [
        { target: "thrust-chamber", label: "Attached to the chamber throat" },
        { target: "gimbal", label: "Moves with the chamber on the gimbal" },
        { target: "interstage", label: "Stowed inside the interstage before separation" }
      ],
      education:
        "A rocket nozzle is a funnel that gets wider, not narrower. In supersonic flow, " +
        "widening the duct speeds the gas up.",
      failureMode:
        "Nozzle damage changes the expansion and can cause flow separation inside the bell, " +
        "producing violent side loads that destroy the engine.",
      facts: ["At sea level the exhaust is over-expanded; flow separation starts near the rim."],
      keywords: ["nozzle", "bell", "expansion", "exhaust", "thrust"]
    },
    gimbal: {
      name: "Gimbal & Thrust Vector Actuators",
      short: "Engine steering bearing and hydraulic/electric actuators",
      category: "Guidance & control",
      function:
        "Tilts the whole engine a few degrees so its thrust line passes offset from the " +
        "vehicle's centre of gravity, producing a steering moment.",
      principle:
        "Two orthogonal actuators push against a spherical bearing. A 5° tilt on a 1 m " +
        "lever arm gives a measurable side force — enough to hold attitude against wind " +
        "gusts and trajectory drift.",
      role:
        "It is the only steering authority during first-stage flight; without it the " +
        "vehicle cannot correct its attitude.",
      specs: [
        { label: "Tilt range", value: "± 5°" },
        { label: "Actuator rate", value: "20 °/s" },
        { label: "Actuation", value: "Electro-mechanical (EMA)" },
        { label: "Bearing", value: "Spherical, self-aligning" }
      ],
      materials: ["Titanium alloy", "Hardened bearing steel"],
      relations: [
        { target: "thrust-chamber", label: "Moves the chamber and nozzle together" },
        { target: "avionics-bay", label: "Receives steering commands from the flight computer" },
        { target: "fuel-tank", label: "Reaction loads go into the thrust structure and tank" }
      ],
      education:
        "Instead of adding small steering thrusters, most launchers simply tilt the big " +
        "engine — the same idea as tilting an outboard motor to steer a boat.",
      failureMode:
        "A stuck actuator causes a slow attitude divergence; the flight computer eventually " +
        "triggers range safety.",
      facts: [],
      keywords: ["gimbal", "tvc", "steering", "actuator", "control"]
    },
    "thrust-structure": {
      name: "Thrust Structure & Heat Shield",
      short: "Engine mount frame and base heat shield",
      category: "Primary structure",
      function:
        "Collects the engine's thrust and spreads it into the tank skirt, while shielding " +
        "the vehicle base from engine radiation and exhaust recirculation.",
      principle:
        "A truss of struts runs from the gimbal mount to the tank skirt, carrying several " +
        "hundred tonnes of axial load. An ablative heat shield covers the base to keep " +
        "radiated heat away from plumbing and avionics.",
      role:
        "It is the mechanical junction between propulsion and structure — every newton of " +
        "thrust passes through it.",
      specs: [
        { label: "Thrust load", value: "≈ 845 kN" },
        { label: "Mass", value: "~340 kg" },
        { label: "Heat shield", value: "Cork ablator on aluminium" },
        { label: "Load path", value: "8 struts, redundant pairs" }
      ],
      materials: ["Aluminium alloy", "Titanium struts", "Cork ablator"],
      relations: [
        { target: "gimbal", label: "Supports the gimbal bearing" },
        { target: "fuel-tank", label: "Transfers thrust into the fuel tank skirt" },
        { target: "nozzle", label: "Protects plumbing from nozzle radiation" }
      ],
      education:
        "The engine pushes up; the tank must be pushed up too. This frame is the adapter " +
        "that turns a concentrated engine load into an even ring load.",
      failureMode:
        "A strut failure redistributes load to its neighbours and can start a cascade.",
      facts: [],
      keywords: ["thrust", "structure", "frame", "heat shield", "mount"]
    },
    "grid-fin": {
      name: "Grid Fins & Landing Legs",
      short: "Aerodynamic control surfaces for first-stage recovery",
      category: "Recovery systems",
      function:
        "Steer the stage during its unpowered descent and support it after touchdown.",
      principle:
        "Lattice fins present a large frontal area in a small package, giving strong " +
        "control authority at high angle of attack. Differential deflection rolls the " +
        "stage; symmetric deflection pitches it. Legs deploy on gas springs before landing.",
      role:
        "Only present on reusable vehicles, but they decide whether the booster is recovered.",
      specs: [
        { label: "Fin span", value: "1.2 m" },
        { label: "Actuation", value: "Electro-mechanical, ± 20°" },
        { label: "Legs", value: "4 × carbon-fibre, gas-spring deployed" },
        { label: "Deployment time", value: "< 3 s" }
      ],
      materials: ["Titanium casting", "Carbon-fibre legs"],
      relations: [
        { target: "avionics-bay", label: "Commands fin deflection and leg deployment" },
        { target: "fuel-tank", label: "Mounted on the interstage / tank skirt" }
      ],
      education:
        "Grid fins work like venetian blinds: many small surfaces in a compact frame give " +
        "a lot of control force in a small volume.",
      failureMode:
        "A jammed fin forces the controller to abort the landing burn and ditch the stage.",
      facts: [],
      keywords: ["grid fin", "landing", "recovery", "legs", "control"]
    }
  },

  /* ===================================================================== */
  turbojet: {
    inlet: {
      name: "Inlet Duct",
      short: "Diffuser that slows incoming air and raises its pressure",
      category: "Air intake",
      function:
        "Delivers the airflow to the compressor with as little pressure loss and distortion " +
        "as possible.",
      principle:
        "The duct diverges slightly, so supersonic or high-subsonic air slows down and " +
        "increases in static pressure before the first compressor stage. A boundary-layer " +
        "splitter keeps disturbed air out of the engine face.",
      role:
        "Any pressure lost in the inlet must be made up by the compressor, so inlet quality " +
        "is directly paid for in fuel burn.",
      specs: [
        { label: "Airflow", value: "≈ 80 kg/s" },
        { label: "Pressure recovery", value: "> 0.97" },
        { label: "Mach at compressor face", value: "0.45–0.55" }
      ],
      materials: ["Aluminium alloy", "Composite lip"],
      relations: [
        { target: "lp-compressor", label: "Feeds the low-pressure compressor" },
        { target: "nacelle", label: "Structurally part of the nacelle" }
      ],
      education:
        "The inlet is not a passive hole: its shape does work on the air before the engine " +
        "ever sees it.",
      failureMode:
        "Inlet distortion can stall the compressor, producing a loud surge and a sudden " +
        "thrust loss.",
      facts: [],
      keywords: ["inlet", "intake", "duct", "diffuser", "air"]
    },
    "lp-compressor": {
      name: "Low-Pressure Compressor",
      short: "First compression stage, driven by the LP turbine",
      category: "Compression",
      function:
        "Raises the pressure of the incoming air in the first stage of compression.",
      principle:
        "Alternating rotating blades (rotors) and static vanes (stators) repeatedly add " +
        "tangential velocity and then diffuse it into pressure. Each stage adds a modest " +
        "pressure ratio; many stages in series give a large total.",
      role:
        "It sets the core mass flow and provides the right pressure to the high-pressure " +
        "compressor.",
      specs: [
        { label: "Pressure ratio", value: "≈ 3.2 : 1" },
        { label: "Stages", value: "4" },
        { label: "Rotational speed", value: "≈ 9,000 rpm" },
        { label: "Tip speed", value: "≈ 350 m/s" }
      ],
      materials: ["Titanium alloy blades", "Steel discs"],
      relations: [
        { target: "inlet", label: "Fed by the inlet duct" },
        { target: "hp-compressor", label: "Supplies pre-compressed air" },
        { target: "lp-turbine", label: "Driven through the LP shaft" }
      ],
      education:
        "Compression is done in steps because compressing too much in one stage would stall " +
        "the blades. Many small steps are stable and efficient.",
      failureMode:
        "A blade failure releases debris downstream and can destroy the engine in a " +
        "fraction of a second.",
      facts: [],
      keywords: ["compressor", "fan", "blades", "compression"]
    },
    "hp-compressor": {
      name: "High-Pressure Compressor",
      short: "Core compressor raising pressure for combustion",
      category: "Compression",
      function:
        "Takes the LP compressor's output to the high pressure needed for efficient " +
        "combustion and high specific thrust.",
      principle:
        "Blades get progressively shorter as air density rises. Variable stator vanes " +
        "adjust incidence at off-design speeds to keep the front stages from stalling.",
      role:
        "It defines the engine's overall pressure ratio — the single biggest driver of " +
        "thermal efficiency.",
      specs: [
        { label: "Pressure ratio", value: "≈ 8 : 1 (core total ≈ 12 : 1)" },
        { label: "Stages", value: "6" },
        { label: "Exit temperature", value: "≈ 800 K" },
        { label: "Rotational speed", value: "≈ 15,000 rpm" }
      ],
      materials: ["Nickel alloy rear stages", "Titanium front stages"],
      relations: [
        { target: "lp-compressor", label: "Receives pre-compressed air" },
        { target: "combustor", label: "Delivers air to the combustion chamber" },
        { target: "hp-turbine", label: "Driven by the HP turbine through its own shaft" },
        { target: "fuel-nozzles", label: "Supplies air that mixes with the fuel spray" }
      ],
      education:
        "Air heats up as it is compressed even without fuel. That is why the last compressor " +
        "stages are made of nickel alloys and are cooled.",
      failureMode:
        "A compressor surge reverses flow briefly, causing loud bangs and possible flameout.",
      facts: [],
      keywords: ["compressor", "hpc", "core", "pressure"]
    },
    combustor: {
      name: "Annular Combustor",
      short: "Combustion chamber where fuel energy is released",
      category: "Combustion",
      function:
        "Burns fuel in a controlled, stable flame that leaves the turbine with a uniform " +
        "temperature profile it can survive.",
      principle:
        "Only about a quarter of the air enters the primary zone for combustion; the rest " +
        "is used for cooling the liner and diluting the products before they reach the " +
        "turbine. Swirl stabilises the flame so it does not blow out.",
      role:
        "This is where the cycle adds energy. Outlet temperature sets the power the turbine " +
        "can extract — and the life of the turbine blades.",
      specs: [
        { label: "Combustion efficiency", value: "> 99 %" },
        { label: "Outlet temperature", value: "≈ 1,750 K" },
        { label: "Pressure loss", value: "≈ 4 %" },
        { label: "Fuel", value: "Jet A-1 kerosene" }
      ],
      materials: ["Nickel superalloy liner", "Thermal-barrier ceramic coating"],
      relations: [
        { target: "fuel-nozzles", label: "Fuel is injected by the nozzle ring" },
        { target: "hp-compressor", label: "Receives combustion air" },
        { target: "hp-turbine", label: "Exhausts hot gas into the turbine" }
      ],
      education:
        "The flame never touches the metal directly — a film of cooler air is deliberately " +
        "bled along the liner wall.",
      failureMode:
        "A rich blowout or lean extinction kills combustion; the engine must be relit or " +
        "the aircraft has lost thrust.",
      facts: ["Flame temperature is far above the melting point of the liner material."],
      keywords: ["combustor", "combustion", "flame", "burner"]
    },
    "fuel-nozzles": {
      name: "Fuel Nozzle Ring",
      short: "Atomising injectors around the combustor dome",
      category: "Fuel system",
      function:
        "Sprays metered fuel into the combustor as a fine, well-distributed mist.",
      principle:
        "Pressure-swirl or air-blast atomisers break the fuel into droplets of a few tens " +
        "of microns so it evaporates and mixes quickly. Flow is trimmed per nozzle so all " +
        "sectors burn at the same temperature.",
      role:
        "Atomisation quality controls combustion efficiency, emissions and the temperature " +
        "spread that the turbine has to tolerate.",
      specs: [
        { label: "Nozzle count", value: "18" },
        { label: "Injection pressure", value: "1–4 MPa" },
        { label: "Droplet size", value: "20–60 µm" },
        { label: "Fuel flow", value: "≈ 1.1 kg/s at takeoff" }
      ],
      materials: ["Stainless steel", "Heat-resistant alloy tips"],
      relations: [
        { target: "combustor", label: "Injects into the combustor dome" },
        { target: "accessory-gearbox", label: "Fed by the fuel pump on the accessory gearbox" },
        { target: "hp-compressor", label: "Uses compressor air for air-blast atomisation" }
      ],
      education:
        "Liquid fuel will not burn as a stream — it has to be turned into a cloud first, " +
        "which is exactly what the nozzle does.",
      failureMode:
        "A coked or blocked nozzle creates a hot streak that burns the turbine blades " +
        "behind it.",
      facts: [],
      keywords: ["fuel", "nozzle", "injector", "spray", "atomiser"]
    },
    "hp-turbine": {
      name: "High-Pressure Turbine",
      short: "Stage that drives the HP compressor",
      category: "Expansion",
      function:
        "Extracts mechanical power from the hot gas to drive the high-pressure compressor.",
      principle:
        "Nozzle guide vanes accelerate and swirl the flow, then rotor blades turn it back " +
        "toward the axis. The change in tangential momentum appears as shaft torque. Blades " +
        "are internally cooled with compressor air and coated with a ceramic layer.",
      role:
        "It is the most thermally loaded part of the engine and the usual limit on turbine " +
        "entry temperature — and therefore on thrust.",
      specs: [
        { label: "Inlet temperature", value: "≈ 1,750 K" },
        { label: "Power extracted", value: "≈ 20 MW" },
        { label: "Stages", value: "1–2" },
        { label: "Blade cooling", value: "Film + internal convection" }
      ],
      materials: ["Single-crystal nickel superalloy", "Yttria-stabilised zirconia coating"],
      relations: [
        { target: "combustor", label: "Fed by combustor exhaust" },
        { target: "hp-compressor", label: "Drives the compressor through the HP shaft" },
        { target: "lp-turbine", label: "Passes partially expanded gas downstream" }
      ],
      education:
        "The turbine is a windmill in a furnace. It survives because it is cooled from " +
        "inside with air that never sees the flame.",
      failureMode:
        "Blade creep or coating loss leads to tip rub, vibration and eventually blade " +
        "release.",
      facts: [],
      keywords: ["turbine", "hpt", "blades", "expansion"]
    },
    "lp-turbine": {
      name: "Low-Pressure Turbine",
      short: "Final expansion stage driving the fan/compressor",
      category: "Expansion",
      function:
        "Extracts the remaining usable energy from the gas and drives the low-pressure " +
        "compressor.",
      principle:
        "Several stages with increasing annulus area handle the large volumetric flow of " +
        "low-pressure gas. Long blades are shrouded and interlocked to damp vibration.",
      role:
        "It sets exhaust velocity and the residual energy available for thrust.",
      specs: [
        { label: "Stages", value: "4" },
        { label: "Exit temperature", value: "≈ 900 K" },
        { label: "Blade length", value: "up to 0.4 m" },
        { label: "Power extracted", value: "≈ 9 MW" }
      ],
      materials: ["Nickel alloy", "Shrouded blade segments"],
      relations: [
        { target: "hp-turbine", label: "Receives gas from the HP turbine" },
        { target: "lp-compressor", label: "Drives the LP compressor via the LP shaft" },
        { target: "exhaust-nozzle", label: "Discharges into the exhaust nozzle" }
      ],
      education:
        "Two turbines on two concentric shafts let the engine spin its two compressor " +
        "sections at their own best speeds.",
      failureMode:
        "Blade fatigue from vibration can crack long turbine blades at the root.",
      facts: [],
      keywords: ["turbine", "lpt", "exhaust", "expansion"]
    },
    "exhaust-nozzle": {
      name: "Exhaust Nozzle",
      short: "Variable-area jet pipe and nozzle",
      category: "Exhaust",
      function:
        "Accelerates the remaining gas to the highest practical velocity and sets the exit " +
        "area to match the operating point.",
      principle:
        "A convergent duct accelerates subsonic flow to sonic speed at the throat. A " +
        "variable throat keeps the engine matched as airflow changes, and a divergent " +
        "section is added for supersonic expansion.",
      role:
        "Thrust is mass flow × velocity; the nozzle is where that velocity is finally " +
        "established.",
      specs: [
        { label: "Exit velocity", value: "600–900 m/s" },
        { label: "Throat area", value: "variable, 0.28–0.42 m²" },
        { label: "Thrust", value: "≈ 55 kN dry" },
        { label: "Specific fuel consumption", value: "≈ 0.75 lb/lbf·h" }
      ],
      materials: ["Nickel superalloy", "Titanium outer shell"],
      relations: [
        { target: "lp-turbine", label: "Receives turbine exit gas" },
        { target: "nacelle", label: "Mounted at the aft end of the nacelle" }
      ],
      education:
        "A jet engine makes thrust by throwing mass backward. Big mass, moderate speed " +
        "(a fan) is efficient; small mass, huge speed (a turbojet) is loud and fast.",
      failureMode:
        "Nozzle-area actuator failure leaves the engine mismatched, causing surge or " +
        "thrust loss.",
      facts: [],
      keywords: ["nozzle", "exhaust", "jet", "thrust", "convergent"]
    },
    "hp-shaft": {
      name: "HP Shaft & Bearings",
      short: "Concentric shaft connecting HP compressor and turbine",
      category: "Rotors",
      function:
        "Transmits torque from the HP turbine to the HP compressor while keeping the rotor " +
        "assembly aligned at very high speed.",
      principle:
        "A hollow shaft rides on rolling-element bearings. Thrust loads are taken by a " +
        "ball bearing; radial loads by roller bearings. Oil jets cool and lubricate the " +
        "elements, and squeeze-film dampers suppress rotor whirl.",
      role:
        "The rotor is the engine's spine. Its critical speeds determine which RPMs can be " +
        "used without destructive vibration.",
      specs: [
        { label: "Speed", value: "≈ 15,000 rpm" },
        { label: "Bearings", value: "1 ball, 2 roller" },
        { label: "Critical speed margin", value: "> 20 %" },
        { label: "Lubrication", value: "Recirculating oil, jet fed" }
      ],
      materials: ["High-strength steel", "Ceramic rolling elements"],
      relations: [
        { target: "hp-turbine", label: "Driven by the HP turbine" },
        { target: "hp-compressor", label: "Drives the HP compressor" },
        { target: "accessory-gearbox", label: "Takes off power for accessories" }
      ],
      education:
        "Every rotating machine has resonant speeds. Engineers place bearings so normal " +
        "operating speeds sit far away from those resonances.",
      failureMode:
        "Bearing seizure or shaft whirl destroys the rotor within seconds.",
      facts: [],
      keywords: ["shaft", "bearing", "rotor", "hp"]
    },
    "accessory-gearbox": {
      name: "Accessory Gearbox",
      short: "Gear train driving pumps and generators",
      category: "Accessories",
      function:
        "Takes a small amount of shaft power to run fuel pumps, oil pumps, hydraulic pumps " +
        "and the electrical generator.",
      principle:
        "A bevel gear off the HP shaft drives a gear train with several take-off pads. " +
        "Each pad runs at a speed matched to its accessory.",
      role:
        "Without it the engine cannot feed itself fuel or oil — an engine is only " +
        "self-sustaining once its accessory drives work.",
      specs: [
        { label: "Power take-off", value: "≈ 250 kW" },
        { label: "Pads", value: "6" },
        { label: "Gear ratio", value: "0.42 : 1" }
      ],
      materials: ["Case-hardened steel gears", "Aluminium housing"],
      relations: [
        { target: "hp-shaft", label: "Driven from the HP shaft" },
        { target: "fuel-nozzles", label: "Drives the high-pressure fuel pump" }
      ],
      education:
        "An engine at rest cannot pump its own fuel. It is spun up by a starter until " +
        "the accessory gearbox can take over.",
      failureMode:
        "A gearbox failure stops fuel and oil supply; the engine shuts down within seconds.",
      facts: [],
      keywords: ["gearbox", "accessory", "pump", "generator"]
    },
    nacelle: {
      name: "Nacelle & Casing",
      short: "Outer casing and containment structure",
      category: "Structure",
      function:
        "Forms the aerodynamic outer surface, contains the gas path, and provides a " +
        "containment case in case of a rotor failure.",
      principle:
        "An inner case carries the stator vanes and gas pressure; the outer cowl is an " +
        "aerodynamic fairing. A kevlar wrap or thick ring can catch a released blade.",
      role:
        "It is the structural backbone that holds compressor, combustor and turbine " +
        "concentric and aligned.",
      specs: [
        { label: "Diameter", value: "≈ 0.8 m" },
        { label: "Containment", value: "Kevlar wrap on steel case" },
        { label: "Mount points", value: "Front and rear trunnions" }
      ],
      materials: ["Steel casing", "Aluminium cowl", "Kevlar containment"],
      relations: [
        { target: "inlet", label: "Supports the inlet duct" },
        { target: "exhaust-nozzle", label: "Carries the exhaust section" },
        { target: "hp-shaft", label: "Supports the bearing frames" }
      ],
      education:
        "Engines are tested to deliberately release a blade at full speed — the casing must " +
        "keep it inside.",
      failureMode:
        "Containment failure turns an internal engine fault into an airframe hazard.",
      facts: [],
      keywords: ["nacelle", "casing", "containment", "cowl"]
    }
  },

  /* ===================================================================== */
  inlineEngine: {
    "cylinder-block": {
      name: "Cylinder Block",
      short: "Cast structure containing cylinders and coolant passages",
      category: "Structure",
      function:
        "Provides the bores the pistons run in, carries the main bearing loads, and routes " +
        "coolant and oil around the engine.",
      principle:
        "A cast aluminium block with pressed-in or cast-in iron liners. A water jacket " +
        "surrounds each bore; the deck is bolted to the head through a gasket that must " +
        "seal both combustion pressure and coolant.",
      role:
        "It is the engine's skeleton: crankshaft, pistons, head and accessories all locate " +
        "off it, and it has to hold that geometry while hot.",
      specs: [
        { label: "Bore × stroke", value: "84 × 90 mm" },
        { label: "Displacement", value: "1,995 cm³" },
        { label: "Material", value: "Cast aluminium, iron liners" },
        { label: "Deck flatness", value: "< 0.05 mm" },
        { label: "Coolant", value: "50/50 glycol-water, 90 °C" }
      ],
      materials: ["Aluminium-silicon casting", "Cast iron liners"],
      relations: [
        { target: "piston", label: "Bores guide the pistons" },
        { target: "crankshaft", label: "Main bearings support the crankshaft" },
        { target: "cylinder-head", label: "Bolted on top through the head gasket" },
        { target: "water-pump", label: "Coolant jacket is driven by the water pump" }
      ],
      education:
        "The block has to be stiff enough that the crankshaft stays straight under load, " +
        "and open enough that coolant can reach every hot spot.",
      failureMode:
        "Cracks between bore and coolant jacket leak coolant into the cylinder, producing " +
        "white smoke and overheating.",
      facts: [],
      keywords: ["block", "cylinder", "structure", "coolant", "bore"]
    },
    "cylinder-head": {
      name: "Cylinder Head",
      short: "Valve and port casting on top of the block",
      category: "Structure",
      function:
        "Closes the combustion chamber, carries the valves, spark plugs and injectors, and " +
        "forms the intake and exhaust ports.",
      principle:
        "A DOHC head holds two camshafts that act on valves through buckets or roller " +
        "fingers. Ports are shaped to induce swirl and tumble so the incoming charge mixes " +
        "well without restricting flow.",
      role:
        "Gas exchange happens here. Port and valve sizing set how much air the engine can " +
        "breathe, which sets how much torque it can make.",
      specs: [
        { label: "Valves per cylinder", value: "4 (2 intake, 2 exhaust)" },
        { label: "Compression ratio", value: "10.5 : 1" },
        { label: "Material", value: "Aluminium alloy" },
        { label: "Max valve lift", value: "10.5 mm" }
      ],
      materials: ["Aluminium alloy", "Sintered valve seats"],
      relations: [
        { target: "cylinder-block", label: "Bolted to the block" },
        { target: "camshaft", label: "Carries the camshafts" },
        { target: "intake-valve", label: "Houses the intake valves" },
        { target: "spark-plug", label: "Locates the spark plug in the chamber roof" }
      ],
      education:
        "The chamber roof contains the valves at an angle. That angle is a compromise " +
        "between flow, combustion speed and packaging.",
      failureMode:
        "Head gasket failure lets combustion gas into the coolant, causing overheating and " +
        "bubbles in the expansion tank.",
      facts: [],
      keywords: ["head", "valve", "port", "dohc", "gasket"]
    },
    piston: {
      name: "Piston",
      short: "Reciprocating plug that seals combustion",
      category: "Power conversion",
      function:
        "Seals the combustion chamber and transmits the pressure of burning gas to the " +
        "connecting rod as linear force.",
      principle:
        "Gas pressure acts on the piston crown area. Rings seal the gap to the bore while " +
        "allowing sliding: two compression rings hold pressure, one oil-control ring scrapes " +
        "oil back down. The crown is shaped to control charge motion and squish.",
      role:
        "It is the first link in the chain that turns chemical energy into rotation. Peak " +
        "cylinder pressure can exceed 60 bar.",
      specs: [
        { label: "Diameter", value: "84 mm" },
        { label: "Peak cylinder pressure", value: "≈ 65 bar" },
        { label: "Mean piston speed", value: "≈ 12 m/s at 4,000 rpm" },
        { label: "Mass", value: "≈ 290 g" },
        { label: "Rings", value: "2 compression + 1 oil control" }
      ],
      materials: ["Hypereutectic aluminium alloy", "Anodised crown", "Cast-iron rings"],
      relations: [
        { target: "connecting-rod", label: "Transfers force through the wrist pin" },
        { target: "cylinder-block", label: "Slides in the bore on an oil film" },
        { target: "cylinder-head", label: "Forms the moving wall of the combustion chamber" },
        { target: "spark-plug", label: "Receives the expanding gas from ignition" }
      ],
      education:
        "A piston at 4,000 rpm changes direction about 130 times a second. Light weight " +
        "matters as much as strength, because every gram is accelerated each stroke.",
      failureMode:
        "Detonation or overheating causes ring-land fracture, scoring the bore and losing " +
        "compression.",
      facts: ["Piston acceleration at top dead centre can exceed 2,000 g."],
      keywords: ["piston", "combustion", "power", "rings", "reciprocating"]
    },
    "connecting-rod": {
      name: "Connecting Rod",
      short: "Link converting piston force into crankshaft torque",
      category: "Power conversion",
      function:
        "Connects the piston to the crankshaft and converts reciprocating force into torque " +
        "while allowing the crank to rotate.",
      principle:
        "It is a two-force member: compression during the power stroke, tension during " +
        "intake. The small end pivots on the wrist pin; the big end wraps the crank journal " +
        "on a hydrodynamic oil film. Length sets the rod ratio and the engine's torque " +
        "character.",
      role:
        "It sits at the mechanical bottleneck of the engine, carrying the highest cyclic " +
        "loads in the whole assembly.",
      specs: [
        { label: "Centre distance", value: "143 mm" },
        { label: "Peak compressive load", value: "≈ 36 kN" },
        { label: "Mass", value: "≈ 420 g" },
        { label: "Rod ratio", value: "1.59" }
      ],
      materials: ["Forged steel (cracked big end)", "Bronze small-end bush"],
      relations: [
        { target: "piston", label: "Joined by the wrist pin" },
        { target: "crankshaft", label: "Big end runs on the crank journal" }
      ],
      education:
        "Because the rod swings, the piston also experiences side force against the bore — " +
        "one reason pistons and bores wear slightly oval.",
      failureMode:
        "Fatigue at the big end leads to rod failure, which usually exits through the " +
        "block and destroys the engine.",
      facts: [],
      keywords: ["rod", "connecting", "conrod", "link", "torque"]
    },
    crankshaft: {
      name: "Crankshaft",
      short: "Shaft that turns reciprocating force into torque",
      category: "Power conversion",
      function:
        "Accumulates the power strokes of all four cylinders into continuous rotary torque " +
        "and delivers it to the flywheel.",
      principle:
        "Crank throws are offset by half the stroke and phased 180° for an inline four. " +
        "Counterweights cancel the rotating imbalance. Journals ride in hydrodynamic " +
        "bearings, where oil pressure builds a film that carries the load without contact.",
      role:
        "It is the engine's output shaft and its main inertial store, smoothing the pulses " +
        "of individual power strokes.",
      specs: [
        { label: "Stroke", value: "90 mm" },
        { label: "Main journals", value: "5" },
        { label: "Firing order", value: "1-3-4-2" },
        { label: "Torsional limit", value: "≈ 260 N·m continuous" }
      ],
      materials: ["Forged nodular steel", "Induction-hardened journals"],
      relations: [
        { target: "connecting-rod", label: "Journals carry the rod big ends" },
        { target: "flywheel", label: "Bolted flange drives the flywheel" },
        { target: "camshaft", label: "Drives the camshaft through the timing belt" },
        { target: "cylinder-block", label: "Supported in the block main bearings" }
      ],
      education:
        "A four-cylinder crank twists and untwists with every firing pulse — torsional " +
        "vibration, not just bending, is a design driver.",
      failureMode:
        "Bearing wear drops oil pressure; a spun bearing seizes the crank and stops the " +
        "engine instantly.",
      facts: [],
      keywords: ["crankshaft", "crank", "torque", "journal", "shaft"]
    },
    camshaft: {
      name: "Camshaft",
      short: "Rotating lobes that open the valves",
      category: "Valve train",
      function:
        "Opens each valve at the correct crank angle and for the correct duration.",
      principle:
        "Egg-shaped lobes convert rotation into reciprocating lift. The intake and exhaust " +
        "camshafts run at half crank speed, driven by a belt or chain, so the valve events " +
        "stay synchronised with piston position. Variable timing can advance or retard the " +
        "whole cam relative to the crank.",
      role:
        "Cam timing defines the engine's character: overlap improves top-end power, while " +
        "narrow timing improves idle stability and low-end torque.",
      specs: [
        { label: "Drive ratio", value: "1 : 2 (cam : crank)" },
        { label: "Intake duration", value: "≈ 240° crank" },
        { label: "Lift", value: "10.5 mm" },
        { label: "Phasing range", value: "± 25° (VVT)" }
      ],
      materials: ["Chilled cast iron", "Hardened steel lobes"],
      relations: [
        { target: "intake-valve", label: "Lobe acts on the intake valve bucket" },
        { target: "exhaust-valve", label: "Lobe acts on the exhaust valve bucket" },
        { target: "timing-belt", label: "Driven by the timing belt from the crank" },
        { target: "cylinder-head", label: "Runs in bearings in the head" }
      ],
      education:
        "The camshaft is the engine's score: the shape of each lobe decides when and how far " +
        "the valve opens, and that shape is fixed once it is ground.",
      failureMode:
        "A snapped timing belt stops the cam while the crank keeps turning — valves hit " +
        "pistons and the head is destroyed.",
      facts: [],
      keywords: ["camshaft", "cam", "valve", "timing", "lift"]
    },
    "intake-valve": {
      name: "Intake Valve",
      short: "Poppet valve admitting air-fuel charge",
      category: "Valve train",
      function:
        "Admits the air-fuel charge into the cylinder and seals it against compression.",
      principle:
        "A mushroom-shaped poppet is pulled open by the cam and closed by a spring. The " +
        "45° seat angle gives a gas-tight seal; the stem runs in a guide with a stem seal to " +
        "control oil consumption.",
      role:
        "Intake flow area limits how much air the engine can trap, which caps torque.",
      specs: [
        { label: "Head diameter", value: "33 mm" },
        { label: "Seat angle", value: "45°" },
        { label: "Max lift", value: "10.5 mm" },
        { label: "Operating temp.", value: "≈ 400 °C" }
      ],
      materials: ["Silicon-chrome steel", "Stellite seat facing"],
      relations: [
        { target: "cylinder-head", label: "Seats in the head" },
        { target: "camshaft", label: "Opened by the intake cam lobe" },
        { target: "piston", label: "Charge flows past it into the cylinder" }
      ],
      education:
        "Valves are the engine's doors. Their size and opening schedule decide how easily it " +
        "breathes at each speed.",
      failureMode:
        "A burned valve face leaks compression and misfires persistently.",
      facts: [],
      keywords: ["valve", "intake", "poppet", "air"]
    },
    "exhaust-valve": {
      name: "Exhaust Valve",
      short: "Poppet valve releasing burned gas",
      category: "Valve train",
      function:
        "Releases burned gas from the cylinder into the exhaust port after the power stroke.",
      principle:
        "Exhaust valves run far hotter than intake valves because hot gas flows past them " +
        "continuously. Sodium-filled stems and hard seat facings conduct heat into the head " +
        "and resist wear.",
      role:
        "Hot-side flow area and thermal durability set the engine's upper speed limit.",
      specs: [
        { label: "Head diameter", value: "28 mm" },
        { label: "Operating temp.", value: "≈ 750 °C" },
        { label: "Stem", value: "Sodium-filled, 7 mm" },
        { label: "Max lift", value: "9.5 mm" }
      ],
      materials: ["Heat-resistant steel", "Sodium-filled stem", "Stellite facing"],
      relations: [
        { target: "cylinder-head", label: "Seats in the head" },
        { target: "camshaft", label: "Opened by the exhaust cam lobe" },
        { target: "cylinder-block", label: "Exhausts through the port to the manifold" }
      ],
      education:
        "The exhaust valve is the hottest moving part in the engine — often glowing dull red " +
        "under load.",
      failureMode:
        "Overheating causes valve tuliping, loss of clearance and eventually a dropped valve " +
        "that destroys the cylinder.",
      facts: [],
      keywords: ["valve", "exhaust", "hot", "poppet"]
    },
    "spark-plug": {
      name: "Spark Plug",
      short: "Ignition source for the air-fuel charge",
      category: "Ignition",
      function:
        "Creates a high-voltage arc at the right crank angle to start combustion.",
      principle:
        "The ignition coil charges, then discharges 20–35 kV across the electrode gap. The " +
        "arc ionises the mixture and forms a small flame kernel that grows outward. Spark " +
        "timing is advanced as engine speed rises so peak pressure occurs just after top " +
        "dead centre.",
      role:
        "The timing and quality of the flame kernel decide whether combustion is efficient " +
        "or whether it knocks.",
      specs: [
        { label: "Gap", value: "0.9 mm" },
        { label: "Breakdown voltage", value: "20–35 kV" },
        { label: "Torque", value: "23 N·m" },
        { label: "Service life", value: "60,000 km (iridium)" }
      ],
      materials: ["Iridium centre electrode", "Alumina insulator", "Nickel shell"],
      relations: [
        { target: "cylinder-head", label: "Threads into the combustion chamber roof" },
        { target: "piston", label: "Ignites the charge above the piston" }
      ],
      education:
        "Spark timing is a trade: too early and the rising piston fights the pressure; too " +
        "late and the energy leaves through the exhaust.",
      failureMode:
        "A fouled or worn plug misfires, dumping unburned fuel into the exhaust and damaging " +
        "the catalytic converter.",
      facts: [],
      keywords: ["spark", "plug", "ignition", "coil", "combustion"]
    },
    "fuel-injector": {
      name: "Fuel Injector",
      short: "Solenoid valve that meters and atomises fuel",
      category: "Fuel system",
      function:
        "Delivers a precisely timed, precisely measured quantity of fuel directly into the " +
        "cylinder or intake port.",
      principle:
        "A solenoid lifts a needle from its seat for a controlled number of microseconds. " +
        "Rail pressure (up to 20 MPa in direct injection) forces fuel through multi-hole " +
        "nozzles into a fine spray that evaporates in the cylinder.",
      role:
        "Airflow is measured; fuel must match it within about 1 %. Injector behaviour at " +
        "small pulse widths is what limits idle quality and emissions.",
      specs: [
        { label: "Rail pressure", value: "5–20 MPa (GDI)" },
        { label: "Holes", value: "6" },
        { label: "Minimum pulse", value: "≈ 0.4 ms" },
        { label: "Static flow", value: "≈ 1,050 cm³/min" }
      ],
      materials: ["Stainless steel body", "Solenoid coil", "PTFE seals"],
      relations: [
        { target: "cylinder-head", label: "Seated in the head, spraying into the cylinder" },
        { target: "spark-plug", label: "Spray pattern is shaped to meet the spark" },
        { target: "piston", label: "Fuel evaporates in the cylinder above the piston" }
      ],
      education:
        "Direct injection sprays fuel at high pressure onto the piston crown, cooling the " +
        "charge and allowing a higher compression ratio.",
      failureMode:
        "A leaking injector floods a cylinder (hydro-lock risk); a blocked one causes a " +
        "lean misfire and possible pre-ignition.",
      facts: [],
      keywords: ["injector", "fuel", "gdi", "spray", "metering"]
    },
    "timing-belt": {
      name: "Timing Belt & Tensioner",
      short: "Synchronous drive synchronising crank and camshafts",
      category: "Valve train",
      function:
        "Transmits rotation from the crankshaft to the camshafts at exactly half speed, " +
        "without slip.",
      principle:
        "A toothed belt engages matching pulleys so there is no slip. A tensioner takes up " +
        "slack as the belt stretches, and an idler guides the path. Some engines use a chain " +
        "instead for longer life at higher noise.",
      role:
        "It is the mechanical synchroniser of the whole engine. If it slips, valve timing " +
        "is lost immediately.",
      specs: [
        { label: "Teeth", value: "153" },
        { label: "Width", value: "25 mm" },
        { label: "Service interval", value: "120,000 km" },
        { label: "Tensioner", value: "Spring-loaded eccentric idler" }
      ],
      materials: ["HNBR rubber with glass cord", "Nylon tooth facing"],
      relations: [
        { target: "crankshaft", label: "Driven by the crank sprocket" },
        { target: "camshaft", label: "Drives both camshaft sprockets" },
        { target: "water-pump", label: "Often also drives the water pump" }
      ],
      education:
        "Belts are quiet and cheap but degrade with heat; chains last longer but are heavier " +
        "and need oil. Both must keep the cam within a degree of the crank.",
      failureMode:
        "Belt failure is sudden and usually bends valves in an interference engine.",
      facts: [],
      keywords: ["belt", "timing", "chain", "tensioner", "synchronisation"]
    },
    flywheel: {
      name: "Flywheel & Ring Gear",
      short: "Inertial store and clutch/start interface",
      category: "Power transmission",
      function:
        "Stores rotational energy to smooth torque pulses, provides a friction surface for " +
        "the clutch, and carries the starter ring gear.",
      principle:
        "Mass at a large radius gives high rotational inertia, which resists speed changes " +
        "between firing pulses. The ring gear lets the starter motor crank the engine; the " +
        "machined face is the clutch friction surface.",
      role:
        "Without inertia the engine would stumble between power strokes and stall at idle.",
      specs: [
        { label: "Mass", value: "≈ 8.5 kg" },
        { label: "Inertia", value: "≈ 0.12 kg·m²" },
        { label: "Ring gear teeth", value: "129" },
        { label: "Runout limit", value: "0.1 mm" }
      ],
      materials: ["Cast iron", "Hardened ring gear"],
      relations: [
        { target: "crankshaft", label: "Bolted to the crank flange" },
        { target: "cylinder-block", label: "Starter motor engages the ring gear through the block" }
      ],
      education:
        "Inertia is why an engine idles smoothly despite firing only ~30 times a second. " +
        "Lightweight flywheels rev faster but idle rougher.",
      failureMode:
        "Cracks around the bolt circle or a worn ring gear cause hard starting and vibration.",
      facts: [],
      keywords: ["flywheel", "inertia", "starter", "clutch"]
    },
    "water-pump": {
      name: "Water Pump",
      short: "Centrifugal coolant circulator",
      category: "Cooling",
      function:
        "Circulates coolant through the block, head and radiator so heat leaves the engine.",
      principle:
        "A centrifugal impeller driven by the accessory belt or timing belt pushes coolant " +
        "outward. A thermostat opens only above ~88 °C, so the engine warms quickly and " +
        "then holds a stable temperature.",
      role:
        "Cooling keeps metal temperatures low enough for oil to survive and clearances to " +
        "stay correct. About 30 % of fuel energy leaves through the coolant.",
      specs: [
        { label: "Flow", value: "≈ 120 L/min at 4,000 rpm" },
        { label: "Thermostat opens", value: "88 °C" },
        { label: "Pressure cap", value: "1.4 bar" },
        { label: "Impeller", value: "7-vane, plastic" }
      ],
      materials: ["Aluminium housing", "Composite impeller", "Ceramic seal"],
      relations: [
        { target: "cylinder-block", label: "Pumps coolant through the block jacket" },
        { target: "cylinder-head", label: "Coolant returns from the head" },
        { target: "timing-belt", label: "Often driven by the timing belt" }
      ],
      education:
        "A pressurised cooling system raises the boiling point, which lets the engine run " +
        "hotter and more efficiently without boiling over.",
      failureMode:
        "Seal or bearing failure leaks coolant and stops circulation, leading to rapid " +
        "overheating and head warpage.",
      facts: [],
      keywords: ["cooling", "pump", "radiator", "thermostat", "coolant"]
    }
  },

  /* ===================================================================== */
  gearTrain: {
    "input-shaft": {
      name: "Input Shaft & Drive Gear",
      short: "High-speed input with the first pinion",
      category: "Power input",
      function:
        "Takes power from the prime mover and introduces it into the gear train at the " +
        "first reduction stage.",
      principle:
        "A hardened pinion with a small tooth count meshes with a much larger gear. With 18 " +
        "teeth driving 54, speed drops by 3:1 and torque rises by 3:1 (minus losses).",
      role:
        "It sets the direction of power flow and the first part of the total ratio.",
      specs: [
        { label: "Input speed", value: "1,500 rpm" },
        { label: "Teeth", value: "18" },
        { label: "Module", value: "3 mm" },
        { label: "Torque in", value: "≈ 95 N·m" }
      ],
      materials: ["Case-hardened 20MnCr5 steel"],
      relations: [
        { target: "idler-gear", label: "Meshes with the idler gear" },
        { target: "bearing", label: "Supported by two deep-groove bearings" },
        { target: "housing", label: "Seated in the housing bore" }
      ],
      education:
        "A small gear driving a big gear slows things down and multiplies force — the same " +
        "principle as a long lever.",
      failureMode:
        "Tooth pitting from overload spreads until teeth break, which usually jams the train.",
      facts: [],
      keywords: ["input", "shaft", "pinion", "gear", "speed"]
    },
    "idler-gear": {
      name: "Idler Gear",
      short: "Intermediate gear reversing direction",
      category: "Power transmission",
      function:
        "Transfers power between the input pinion and output gear while reversing the " +
        "direction of rotation.",
      principle:
        "An idler does not change the overall ratio — it only changes direction. Its teeth " +
        "are loaded on both faces in a reversing duty, so it needs a symmetric tooth form.",
      role:
        "It bridges the centre distance between the input and output shafts.",
      specs: [
        { label: "Teeth", value: "42" },
        { label: "Speed", value: "643 rpm" },
        { label: "Torque", value: "≈ 220 N·m" },
        { label: "Mounting", value: "Straddle-mounted on a fixed pin" }
      ],
      materials: ["Through-hardened alloy steel"],
      relations: [
        { target: "input-shaft", label: "Driven by the input pinion" },
        { target: "output-gear", label: "Drives the output gear" },
        { target: "lubrication-jet", label: "Oil jet aimed at the mesh contact" }
      ],
      education:
        "Adding an idler makes the output spin the other way without changing the gear " +
        "ratio. Two gears would reverse direction only if you crossed the shafts.",
      failureMode:
        "Bearing seizure on the idler pin locks the train and can shear teeth.",
      facts: [],
      keywords: ["idler", "gear", "intermediate", "direction"]
    },
    "output-gear": {
      name: "Output Gear",
      short: "Large final reduction gear",
      category: "Power transmission",
      function:
        "Delivers the final torque multiplication to the output shaft.",
      principle:
        "A large-diameter gear spreads tooth load over many teeth in contact. Helical teeth " +
        "engage gradually, which is quieter and stronger than straight teeth but produces " +
        "an axial thrust that bearings must carry.",
      role:
        "It is the last stage, so it carries the highest torque and the largest tooth loads " +
        "in the train.",
      specs: [
        { label: "Teeth", value: "90" },
        { label: "Speed", value: "300 rpm" },
        { label: "Torque out", value: "≈ 465 N·m" },
        { label: "Helix angle", value: "15°" },
        { label: "Total ratio", value: "5 : 1" }
      ],
      materials: ["Case-hardened alloy steel", "Ground flanks"],
      relations: [
        { target: "idler-gear", label: "Driven by the idler" },
        { target: "output-shaft", label: "Keyed to the output shaft" },
        { target: "bearing", label: "Carries radial and axial thrust loads" }
      ],
      education:
        "Big gear, big torque. This is why gearboxes are heavy: torque capacity scales with " +
        "tooth size and face width.",
      failureMode:
        "Bending fatigue at the tooth root causes a tooth to break off, which then damages " +
        "the following teeth in a chain reaction.",
      facts: [],
      keywords: ["output", "gear", "torque", "reduction", "helical"]
    },
    "output-shaft": {
      name: "Output Shaft",
      short: "Low-speed high-torque output",
      category: "Power output",
      function:
        "Carries the reduced-speed, high-torque output to the driven machine.",
      principle:
        "A large-diameter shaft keeps torsional stress and deflection low. A key or spline " +
        "transmits torque without relying on friction, and a shoulder locates the gear " +
        "axially.",
      role:
        "It is the interface to the outside world and must tolerate misalignment from the " +
        "coupling.",
      specs: [
        { label: "Diameter", value: "60 mm" },
        { label: "Torque", value: "465 N·m" },
        { label: "Torsional stress", value: "≈ 11 MPa" },
        { label: "Coupling", value: "Keyed flange" }
      ],
      materials: ["Medium-carbon steel, induction hardened"],
      relations: [
        { target: "output-gear", label: "Carries the output gear" },
        { target: "bearing", label: "Runs in the output bearings" },
        { target: "housing", label: "Exits through a lip seal in the housing" }
      ],
      education:
        "Doubling shaft diameter makes it roughly 16× stiffer in torsion — diameter matters " +
        "far more than length for strength.",
      failureMode:
        "Fatigue cracking at the keyway corner is the classic shaft failure; keyways are " +
        "stress concentrators.",
      facts: [],
      keywords: ["shaft", "output", "torque", "keyway", "coupling"]
    },
    bearing: {
      name: "Rolling Bearings",
      short: "Radial and thrust supports for the shafts",
      category: "Support",
      function:
        "Support the rotating shafts with low friction while locating them axially.",
      principle:
        "Hardened steel balls or rollers roll between inner and outer rings. Contact is " +
        "nearly rolling, so friction is very low compared with a plain bearing. A cage " +
        "keeps elements spaced, and seals retain grease or oil.",
      role:
        "Every shaft needs at least two supports; bearing choice sets the gearbox's speed " +
        "limit and life.",
      specs: [
        { label: "Type", value: "Deep-groove ball + cylindrical roller" },
        { label: "L10 life", value: "> 20,000 h" },
        { label: "Radial load", value: "up to 12 kN" },
        { label: "Lubrication", value: "Oil splash + jets" }
      ],
      materials: ["Bearing steel (100Cr6)", "Brass cage"],
      relations: [
        { target: "input-shaft", label: "Supports the input shaft" },
        { target: "output-shaft", label: "Supports the output shaft" },
        { target: "housing", label: "Outer rings sit in housing bores" },
        { target: "lubrication-jet", label: "Fed oil directly" }
      ],
      education:
        "Bearings fail from contamination and misalignment far more often than from pure " +
        "overload. Clean oil is the main life extender.",
      failureMode:
        "Spalling on the raceway produces vibration and heat, then seizure.",
      facts: [],
      keywords: ["bearing", "roller", "ball", "support", "friction"]
    },
    housing: {
      name: "Gearbox Housing",
      short: "Load-bearing casing with bearing bores",
      category: "Structure",
      function:
        "Holds every shaft in precise alignment, contains the oil, and reacts the gear " +
        "separation forces into the mounting feet.",
      principle:
        "Bores are machined in one setup so their centre distances are exact. Ribs stiffen " +
        "the walls against the separating force between meshing gears — roughly the tooth " +
        "load, which tries to push the shafts apart.",
      role:
        "Alignment is everything in a gearbox: a few hundredths of a millimetre of bore " +
        "misalignment concentrates load on one end of a tooth.",
      specs: [
        { label: "Material", value: "Cast iron GG25" },
        { label: "Bore tolerance", value: "H7" },
        { label: "Oil capacity", value: "2.5 L" },
        { label: "Mounting", value: "4 feet, dowelled" }
      ],
      materials: ["Cast iron", "Machined steel inserts"],
      relations: [
        { target: "bearing", label: "Locates bearing outer rings" },
        { target: "output-shaft", label: "Sealed at the output shaft" },
        { target: "lubrication-jet", label: "Contains the oil circuit" }
      ],
      education:
        "The housing looks passive but it is a precision part: the distance between shaft " +
        "centres must match the gears' pitch geometry exactly.",
      failureMode:
        "Bore wear or a cracked foot allows misalignment, which quickly destroys teeth and " +
        "bearings.",
      facts: [],
      keywords: ["housing", "casing", "structure", "alignment", "oil"]
    },
    "lubrication-jet": {
      name: "Lubrication & Cooling Circuit",
      short: "Pump, jets and oil passages",
      category: "Lubrication",
      function:
        "Supplies filtered oil to every mesh and bearing, and removes the heat those " +
        "contacts generate.",
      principle:
        "A pump draws oil from the sump, pushes it through a filter, and directs jets at " +
        "the mesh contact and bearing entries. Oil forms an elastohydrodynamic film that " +
        "separates the surfaces under extreme pressure.",
      role:
        "Without a film, gear teeth scuff and weld within seconds. Oil also carries away " +
        "most of the heat.",
      specs: [
        { label: "Flow", value: "≈ 12 L/min" },
        { label: "Oil grade", value: "ISO VG 220" },
        { label: "Filtration", value: "10 µm" },
        { label: "Sump temperature", value: "60–80 °C" }
      ],
      materials: ["Steel piping", "Bronze nozzle inserts"],
      relations: [
        { target: "idler-gear", label: "Jet aimed at the mesh" },
        { target: "bearing", label: "Feeds the bearing pockets" },
        { target: "housing", label: "Circuit is contained by the housing" }
      ],
      education:
        "Oil in a gearbox does three jobs at once: separates surfaces, removes heat, and " +
        "flushes wear particles to the filter.",
      failureMode:
        "Loss of oil pressure leads to scuffing and seizure in under a minute under load.",
      facts: [],
      keywords: ["oil", "lubrication", "cooling", "pump", "filter"]
    },
    "inspection-cover": {
      name: "Inspection Cover",
      short: "Removable cover with breather and sight glass",
      category: "Service",
      function:
        "Seals the housing while allowing inspection of the oil level and gear condition.",
      principle:
        "A gasketed plate with a sight glass shows the oil level. A breather equalises " +
        "pressure as the gearbox warms, preventing seals from being pushed out.",
      role:
        "Maintenance access: the cover is removed to inspect tooth wear and to top up oil.",
      specs: [
        { label: "Fasteners", value: "8 × M8" },
        { label: "Gasket", value: "Cork-nitrile" },
        { label: "Breather", value: "Sintered filter" }
      ],
      materials: ["Aluminium plate", "Nitrile gasket", "Glass sight"],
      relations: [
        { target: "housing", label: "Bolts onto the housing" },
        { target: "lubrication-jet", label: "Used to check the oil circuit" }
      ],
      education:
        "A blocked breather pressurises the housing and pushes oil past the seals — a " +
        "common and easily prevented failure.",
      failureMode:
        "A leaking gasket drips oil onto the floor and lowers the level until lubrication " +
        "fails.",
      facts: [],
      keywords: ["cover", "inspection", "breather", "service", "seal"]
    }
  },

  /* ===================================================================== */
  robotArm: {
    base: {
      name: "Robot Base",
      short: "Foundation casting anchored to the floor",
      category: "Structure",
      function:
        "Takes every load the arm generates and anchors the robot to the floor.",
      principle:
        "A large flat base with anchor bolts resists the overturning moment created when " +
        "the arm reaches out at speed. Stiffness here matters most because every downstream " +
        "error is amplified through the arm.",
      role:
        "It defines the robot's world frame and is the reference for all calibration.",
      specs: [
        { label: "Footprint", value: "650 × 650 mm" },
        { label: "Mass", value: "≈ 210 kg" },
        { label: "Anchor bolts", value: "4 × M20" },
        { label: "Repeatability contribution", value: "< 0.005 mm" }
      ],
      materials: ["Cast iron", "Zinc-plated anchors"],
      relations: [
        { target: "j1-drive", label: "Mounts the first axis drive" },
        { target: "cable-harness", label: "Cable entry from the controller" }
      ],
      education:
        "A robot is only as stiff as its mounting. Bolting to a weak floor turns every " +
        "motion into vibration.",
      failureMode:
        "Anchor loosening causes chatter, loss of accuracy and eventually a safety hazard.",
      facts: [],
      keywords: ["base", "foundation", "structure", "mount"]
    },
    "j1-drive": {
      name: "Axis 1 Slew Drive",
      short: "Shoulder rotation about the vertical axis",
      category: "Actuation",
      function:
        "Rotates the whole arm about the vertical axis, defining the working envelope's " +
        "swept sector.",
      principle:
        "A servo motor drives a high-ratio gear (harmonic or cycloidal) that multiplies " +
        "torque and provides near-zero backlash. An encoder on the motor plus one on the " +
        "joint give absolute and precise position.",
      role:
        "Axis 1 moves the largest inertia in the system, so it is heavily geared and its " +
        "acceleration is limited to keep the arm from whipping.",
      specs: [
        { label: "Range", value: "± 175°" },
        { label: "Max speed", value: "165 °/s" },
        { label: "Gear ratio", value: "≈ 120 : 1" },
        { label: "Repeatability", value: "± 0.02 mm at tool" }
      ],
      materials: ["Steel gears", "Aluminium housing", "Absolute encoder"],
      relations: [
        { target: "base", label: "Bolted to the base casting" },
        { target: "shoulder-link", label: "Carries the shoulder link" },
        { target: "harmonic-drive", label: "Uses a harmonic reduction stage" }
      ],
      education:
        "High gear ratios let small motors move heavy arms, but they add friction and " +
        "compliance — that is why industrial robots feel stiff rather than springy.",
      failureMode:
        "Encoder drift or gear wear shows up as position error that grows with payload.",
      facts: [],
      keywords: ["axis", "slew", "servo", "gear", "joint"]
    },
    "shoulder-link": {
      name: "Shoulder Link (Axis 2)",
      short: "First major arm segment lift",
      category: "Structure",
      function:
        "Lifts the arm assembly and sets the working height of the wrist.",
      principle:
        "A hollow cast link carries bending and torsion. Its drive sits at the shoulder so " +
        "the motor's mass does not have to be lifted by the arm itself.",
      role:
        "Together with the elbow it determines reach in the vertical plane.",
      specs: [
        { label: "Length", value: "780 mm" },
        { label: "Range", value: "− 60° / + 85°" },
        { label: "Max speed", value: "150 °/s" },
        { label: "Payload moment", value: "≈ 1,200 N·m" }
      ],
      materials: ["Cast aluminium", "Steel inserts"],
      relations: [
        { target: "j1-drive", label: "Rotates on the axis-1 housing" },
        { target: "elbow-joint", label: "Supports the elbow joint" },
        { target: "cable-harness", label: "Cables routed internally" }
      ],
      education:
        "Hollow links are stronger per kilogram and let cables run inside, which avoids " +
        "snagging and wear.",
      failureMode:
        "Fatigue at the weld between link and bearing housing is a known failure location " +
        "under high cycle counts.",
      facts: [],
      keywords: ["shoulder", "link", "axis", "structure", "reach"]
    },
    "elbow-joint": {
      name: "Elbow Joint (Axis 3)",
      short: "Mid-arm articulation",
      category: "Actuation",
      function:
        "Folds the forearm toward or away from the shoulder, trading reach for height.",
      principle:
        "A servo and reduction gear turn a cross-roller bearing that must handle combined " +
        "radial, axial and moment loads. A brake holds position when power is removed.",
      role:
        "The elbow is what lets the robot reach into a machine and then retract without " +
        "hitting it.",
      specs: [
        { label: "Range", value: "− 185° / + 65°" },
        { label: "Max speed", value: "180 °/s" },
        { label: "Bearing", value: "Cross-roller" },
        { label: "Brake", value: "Spring-applied, 24 V released" }
      ],
      materials: ["Cast aluminium link", "Hardened steel bearing"],
      relations: [
        { target: "shoulder-link", label: "Attached to the shoulder link" },
        { target: "forearm", label: "Carries the forearm" },
        { target: "harmonic-drive", label: "Reduced by a harmonic drive" }
      ],
      education:
        "Joints 1–3 do the positioning, joints 4–6 do the orienting. That split is why six " +
        "axes are enough for almost any task.",
      failureMode:
        "Brake failure drops the arm when power is cut — the reason robots must be " +
        "counter-balanced during maintenance.",
      facts: [],
      keywords: ["elbow", "joint", "axis", "bearing", "brake"]
    },
    forearm: {
      name: "Forearm & Wrist (Axes 4–6)",
      short: "Roll, pitch and yaw of the tool",
      category: "Actuation",
      function:
        "Positions and orients the tool at the required angle in space.",
      principle:
        "Three compact joints in series: axis 4 rolls along the forearm, axis 5 pitches, " +
        "axis 6 rotates the flange. Together they form a spherical wrist, so orientation can " +
        "be solved independently of position.",
      role:
        "The wrist is where the tool meets the work, so its stiffness directly appears as " +
        "machining or assembly error.",
      specs: [
        { label: "Reach (wrist centre)", value: "1,550 mm" },
        { label: "Wrist axes", value: "4, 5, 6" },
        { label: "Payload", value: "12 kg" },
        { label: "Tool flange", value: "ISO 9409-1-50-4-M6" }
      ],
      materials: ["Aluminium housing", "Steel gears"],
      relations: [
        { target: "elbow-joint", label: "Mounted on the elbow" },
        { target: "gripper", label: "Carries the end effector" },
        { target: "harmonic-drive", label: "Each wrist axis has its own reducer" }
      ],
      education:
        "A spherical wrist makes the maths easy: position and orientation decouple, so the " +
        "controller can solve them in two steps.",
      failureMode:
        "Wrist gear wear appears as small orientation errors that grow with tool offset.",
      facts: [],
      keywords: ["forearm", "wrist", "orientation", "axis", "flange"]
    },
    gripper: {
      name: "Two-Finger Gripper",
      short: "Parallel-jaw end effector",
      category: "End effector",
      function:
        "Grasps and holds the workpiece during handling.",
      principle:
        "A motor drives jaws along a linear guide through a wedge or rack mechanism. Force " +
        "is usually regulated, because crushing a part is as bad as dropping it. Jaw pads " +
        "increase friction and protect surfaces.",
      role:
        "The gripper is the only part that touches the product; its repeatability sets the " +
        "placement accuracy of the whole cell.",
      specs: [
        { label: "Stroke", value: "40 mm" },
        { label: "Grip force", value: "5–140 N" },
        { label: "Repeatability", value: "± 0.02 mm" },
        { label: "Actuation", value: "Electric, force controlled" }
      ],
      materials: ["Aluminium jaws", "Steel guide rails", "Nitrile pads"],
      relations: [
        { target: "forearm", label: "Bolted to the tool flange" },
        { target: "cable-harness", label: "Powered and signalled through the arm" }
      ],
      education:
        "Parallel jaws keep the part's orientation fixed as they close, which is why they " +
        "are the default for pick-and-place.",
      failureMode:
        "Jaw pad wear reduces friction and the part slips during acceleration.",
      facts: [],
      keywords: ["gripper", "end effector", "jaw", "grasp", "tool"]
    },
    "harmonic-drive": {
      name: "Harmonic Drive",
      short: "Zero-backlash high-ratio reduction gear",
      category: "Actuation",
      function:
        "Reduces motor speed by 50–160× with almost no backlash, giving precise joint " +
        "control.",
      principle:
        "An oval wave generator flexes a thin flexible spline so its external teeth engage " +
        "a rigid circular spline at two opposite points. Because the flex spline has two " +
        "fewer teeth, it rotates a small amount per input revolution — and multiple teeth " +
        "are always in contact, so backlash is essentially zero.",
      role:
        "It is the reason modern robots are accurate: torque density and stiffness in a very " +
        "compact package.",
      specs: [
        { label: "Ratio", value: "100 : 1" },
        { label: "Backlash", value: "< 1 arcmin" },
        { label: "Efficiency", value: "≈ 80 %" },
        { label: "Repeatability", value: "± 10 arcsec" }
      ],
      materials: ["Hardened steel flex spline", "Grease-lubricated"],
      relations: [
        { target: "j1-drive", label: "First-axis reduction stage" },
        { target: "elbow-joint", label: "Elbow reduction stage" },
        { target: "forearm", label: "Wrist axis reduction stages" }
      ],
      education:
        "Instead of meshing rigid gears, a harmonic drive bends a metal cup by a fraction of " +
        "a millimetre. That flex is what removes the play.",
      failureMode:
        "Flex-spline fatigue from overload causes lost motion and position drift that " +
        "cannot be compensated.",
      facts: [],
      keywords: ["harmonic", "drive", "gearbox", "backlash", "reduction"]
    },
    "cable-harness": {
      name: "Cable Harness",
      short: "Power, encoder and air routing through the arm",
      category: "Wiring",
      function:
        "Carries power, encoder signals and sensor data through every moving joint to the " +
        "tool.",
      principle:
        "Cables run inside the links with service loops at each joint so repeated rotation " +
        "does not fatigue the copper. Shielded encoder pairs resist noise from the motor " +
        "drives.",
      role:
        "A robot is only as reliable as its harness: most field failures trace back to a " +
        "chafed or broken conductor.",
      specs: [
        { label: "Bend cycles", value: "> 10 million (continuous-flex cable)" },
        { label: "Shielding", value: "Encoder pairs foil shielded" },
        { label: "Routing", value: "Internal with service loops" }
      ],
      materials: ["Polyurethane jacket", "Tinned copper", "Shielded pairs"],
      relations: [
        { target: "base", label: "Enters at the base" },
        { target: "gripper", label: "Supplies the end effector" },
        { target: "shoulder-link", label: "Routed through the shoulder link" }
      ],
      education:
        "Cables flex in a fixed loop rather than randomly, because random bending is what " +
        "breaks strands.",
      failureMode:
        "An intermittent encoder conductor produces position glitches that look like " +
        "mechanical faults.",
      facts: [],
      keywords: ["cable", "harness", "wiring", "encoder", "routing"]
    },
    "teach-pendant": {
      name: "Teach Pendant Interface",
      short: "Manual control and programming connection",
      category: "Control",
      function:
        "Lets an operator jog the robot, teach waypoints and run programs safely.",
      principle:
        "A hand-held terminal with a three-position enabling switch: releasing or squeezing " +
        "it stops motion. Jogging moves one axis or one Cartesian direction at reduced speed.",
      role:
        "The pendant is the human-machine boundary: every taught point becomes a program " +
        "coordinate.",
      specs: [
        { label: "Enabling switch", value: "3-position deadman" },
        { label: "Jog speeds", value: "0.25 / 1 / 10 %" },
        { label: "Connection", value: "Ethernet, safety-rated" }
      ],
      materials: ["ABS housing", "Reinforced cable"],
      relations: [
        { target: "j1-drive", label: "Commands the axis drives" },
        { target: "cable-harness", label: "Connected via the controller" }
      ],
      education:
        "The deadman switch exists because a robot cannot see you. Releasing it is the " +
        "fastest way to stop the arm.",
      failureMode:
        "A failed enabling switch is a serious safety defect and must lock the controller " +
        "out of automatic mode.",
      facts: [],
      keywords: ["pendant", "teach", "control", "safety", "programming"]
    }
  },

  /* ===================================================================== */
  controlPCB: {
    "pcb-substrate": {
      name: "PCB Substrate",
      short: "Four-layer FR-4 board with copper planes",
      category: "Structure",
      function:
        "Mechanically supports every component and provides the copper network that " +
        "connects them.",
      principle:
        "Glass-fibre epoxy (FR-4) sheets are laminated with copper. Etching leaves traces; " +
        "plated through-holes connect layers. Inner layers are usually solid power and " +
        "ground planes, which lower impedance and shield signal layers.",
      role:
        "Every signal and every watt of power flows through this laminate. Stack-up design " +
        "is what separates a quiet board from a noisy one.",
      specs: [
        { label: "Layers", value: "4 (signal / GND / PWR / signal)" },
        { label: "Thickness", value: "1.6 mm" },
        { label: "Copper weight", value: "35 µm (1 oz)" },
        { label: "Min trace / space", value: "0.15 / 0.15 mm" },
        { label: "Finish", value: "ENIG" }
      ],
      materials: ["FR-4 glass epoxy", "Copper foil", "Nickel-gold finish"],
      relations: [
        { target: "mcu", label: "Carries and connects the microcontroller" },
        { target: "buck-converter", label: "Distributes its regulated outputs" },
        { target: "usb-connector", label: "Routes the USB differential pair" }
      ],
      education:
        "A PCB is a wiring diagram made physical. The copper planes also act as an " +
        "electrical shield and as a heat spreader.",
      failureMode:
        "Thermal cycling cracks solder joints at the component-to-board interface, which " +
        "causes intermittent faults.",
      facts: ["A four-layer board is the cheapest way to get a solid ground plane."],
      keywords: ["pcb", "board", "substrate", "fr4", "copper"]
    },
    mcu: {
      name: "Microcontroller (MCU)",
      short: "ARM Cortex-M class processor running firmware",
      category: "Logic",
      function:
        "Executes the control firmware: reads sensors, runs control loops and drives outputs.",
      principle:
        "A CPU core, flash memory, SRAM and peripherals (timers, ADC, UART, SPI, I2C) on one " +
        "die. A clock from the crystal sequences instructions; interrupts let time-critical " +
        "events pre-empt the main loop.",
      role:
        "It is the board's decision maker. Its clock accuracy, ADC noise and interrupt " +
        "latency define the achievable control quality.",
      specs: [
        { label: "Core", value: "Cortex-M4F, 168 MHz" },
        { label: "Flash / RAM", value: "1 MB / 192 KB" },
        { label: "ADC", value: "12-bit, 2.4 MS/s" },
        { label: "Supply", value: "3.3 V, ≈ 90 mA" },
        { label: "Package", value: "LQFP-64" }
      ],
      materials: ["Silicon die", "Copper leadframe", "Epoxy moulding"],
      relations: [
        { target: "crystal", label: "Uses the crystal as its timebase" },
        { target: "capacitors", label: "Requires local decoupling on every supply pin" },
        { target: "buck-converter", label: "Powered from the 3.3 V rail" },
        { target: "gpio-header", label: "Drives and reads the header pins" },
        { target: "usb-connector", label: "Exposes a USB device interface" }
      ],
      education:
        "Every pin has a maximum current and a maximum frequency. Good firmware respects " +
        "both, and good hardware makes the limits obvious in the schematic.",
      failureMode:
        "A brownout from inadequate decoupling resets the MCU mid-operation — the classic " +
        "intermittent embedded bug.",
      facts: [],
      keywords: ["mcu", "microcontroller", "processor", "firmware", "logic"]
    },
    "buck-converter": {
      name: "Buck Converter",
      short: "Switching regulator producing 3.3 V from 12 V",
      category: "Power",
      function:
        "Converts the 12 V input to a regulated 3.3 V rail for logic at high efficiency.",
      principle:
        "A switch chops the input at hundreds of kHz; an inductor and capacitor smooth the " +
        "result. Feedback adjusts duty cycle to hold the output voltage. Because the switch " +
        "is either fully on or fully off, losses stay low — typically 90 % efficient.",
      role:
        "It supplies every logic device. Its ripple and transient response decide whether " +
        "the digital side behaves.",
      specs: [
        { label: "Input", value: "9–18 V" },
        { label: "Output", value: "3.3 V / 3 A" },
        { label: "Switching frequency", value: "500 kHz" },
        { label: "Efficiency", value: "≈ 92 %" },
        { label: "Ripple", value: "< 25 mV" }
      ],
      materials: ["Ferrite inductor", "MLCC capacitors", "Power MOSFET"],
      relations: [
        { target: "mcu", label: "Supplies the 3.3 V rail" },
        { target: "capacitors", label: "Needs bulk and ceramic input capacitors" },
        { target: "pcb-substrate", label: "Copper planes carry the high-current loops" }
      ],
      education:
        "A linear regulator would burn the voltage difference as heat. A switcher moves " +
        "energy through an inductor instead, so it stays cool.",
      failureMode:
        "Inductor saturation or a failed feedback divider over-volts the rail and destroys " +
        "the MCU.",
      facts: [],
      keywords: ["buck", "regulator", "power", "dc-dc", "switching"]
    },
    capacitors: {
      name: "Capacitor Bank",
      short: "Bulk and decoupling capacitance",
      category: "Power",
      function:
        "Supplies current locally during fast transients and filters noise on the supply.",
      principle:
        "A capacitor stores charge and resists sudden voltage change. Small ceramic parts " +
        "close to each IC pin handle high-frequency current; large electrolytics absorb " +
        "slower load steps. Low equivalent series inductance matters more than capacitance " +
        "at high frequency.",
      role:
        "Decoupling is what keeps a digital board stable: without it, switching currents " +
        "create voltage dips that corrupt logic.",
      specs: [
        { label: "Bulk", value: "470 µF electrolytic" },
        { label: "Decoupling", value: "22 × 100 nF ceramic" },
        { label: "Voltage rating", value: "25 V (derated)" },
        { label: "ESR", value: "< 20 mΩ" }
      ],
      materials: ["Aluminium electrolytic", "X7R ceramic", "Tantalum"],
      relations: [
        { target: "buck-converter", label: "Smooths the regulator output" },
        { target: "mcu", label: "Decouples each supply pin" },
        { target: "pcb-substrate", label: "Mounted as close to the pins as possible" }
      ],
      education:
        "Put the capacitor where the current is needed, not where it is convenient. A " +
        "centimetre of trace can ruin a decoupling capacitor.",
      failureMode:
        "Electrolytic dry-out raises ESR, causing ripple and resets after a few years of " +
        "hot operation.",
      facts: [],
      keywords: ["capacitor", "decoupling", "filter", "bulk", "esr"]
    },
    crystal: {
      name: "Crystal Oscillator",
      short: "Quartz timebase for the microcontroller",
      category: "Timing",
      function:
        "Provides an accurate, stable frequency reference so the MCU's timing is precise.",
      principle:
        "A quartz blank cut at a specific angle resonates mechanically at a very stable " +
        "frequency when electrically driven. Two load capacitors trim the frequency; the " +
        "MCU's PLL multiplies it up to core speed.",
      role:
        "Everything time-based depends on it: UART baud rate, USB timing, control loop " +
        "period and timestamps.",
      specs: [
        { label: "Frequency", value: "8.000 MHz" },
        { label: "Tolerance", value: "± 20 ppm" },
        { label: "Load capacitance", value: "12 pF" },
        { label: "Stability", value: "± 30 ppm over temperature" }
      ],
      materials: ["Quartz blank", "Ceramic package", "Nickel electrodes"],
      relations: [
        { target: "mcu", label: "Drives the MCU clock input" },
        { target: "pcb-substrate", label: "Placed with short, guarded traces" }
      ],
      education:
        "A 20 ppm error is about 10 minutes per year — fine for a machine, not fine for a " +
        "radio. Different jobs need different timebases.",
      failureMode:
        "Load-capacitor mismatch or mechanical shock shifts the frequency out of tolerance " +
        "and communications fail.",
      facts: [],
      keywords: ["crystal", "oscillator", "clock", "timing", "quartz"]
    },
    "usb-connector": {
      name: "USB Connector",
      short: "USB-C data and power interface",
      category: "Interface",
      function:
        "Connects the board to a host for programming, data transfer and power.",
      principle:
        "Two differential pairs carry SuperSpeed data, one pair carries USB 2.0, and CC " +
        "pins negotiate role and current. The differential pair must be impedance " +
        "controlled (90 Ω) and length matched to preserve signal integrity.",
      role:
        "It is the board's external link during development and often in service.",
      specs: [
        { label: "Standard", value: "USB 2.0 device (480 Mbit/s)" },
        { label: "Differential impedance", value: "90 Ω ± 10 %" },
        { label: "ESD protection", value: "± 15 kV contact" },
        { label: "Power role", value: "Sink, 500 mA" }
      ],
      materials: ["Stainless shell", "Gold-plated contacts", "FR-4 insert"],
      relations: [
        { target: "mcu", label: "Connected to the MCU USB peripheral" },
        { target: "pcb-substrate", label: "Impedance-controlled routing on the board" },
        { target: "buck-converter", label: "Supplies the input rail" }
      ],
      education:
        "High-speed signals are transmission lines: the trace geometry, not just the " +
        "schematic, decides whether the data arrives.",
      failureMode:
        "Repeated cable insertion cracks solder joints; the connector shell takes the " +
        "mechanical load, not the pads.",
      facts: [],
      keywords: ["usb", "connector", "interface", "differential", "data"]
    },
    "gpio-header": {
      name: "GPIO Header",
      short: "0.1-inch pin header for I/O expansion",
      category: "Interface",
      function:
        "Exposes digital and analogue pins for sensors, actuators and debugging.",
      principle:
        "Each pin connects to a MCU port with optional series resistors and ESD diodes. " +
        "Some pins have alternate functions (timers, SPI, I2C) selected in firmware.",
      role:
        "It is the board's expansion surface: most real installations wire their sensors " +
        "here.",
      specs: [
        { label: "Pins", value: "2 × 20" },
        { label: "Pitch", value: "2.54 mm" },
        { label: "Levels", value: "3.3 V, 5 V tolerant inputs" },
        { label: "Current per pin", value: "8 mA" }
      ],
      materials: ["Gold-plated brass", "PBT insulator"],
      relations: [
        { target: "mcu", label: "Wired to MCU ports" },
        { target: "led-array", label: "Can drive the status LEDs" }
      ],
      education:
        "A header pin is not a power supply. Exceeding the per-pin current is one of the " +
        "most common ways to kill a microcontroller.",
      failureMode:
        "Back-EMF from an inductive load without a flyback diode destroys the driver pin.",
      facts: [],
      keywords: ["gpio", "header", "io", "expansion", "pins"]
    },
    "led-array": {
      name: "Status LED Array",
      short: "Indicator LEDs for power, link and fault",
      category: "Indication",
      function:
        "Shows power, communication and fault states to an operator without a computer.",
      principle:
        "Each LED has a series resistor that sets current from the 3.3 V rail. Firmware " +
        "drives them, often with PWM for brightness. Colour choice and blink pattern encode " +
        "meaning.",
      role:
        "The fastest diagnostic tool on the board. A blink code can identify a fault before " +
        "anyone connects a debugger.",
      specs: [
        { label: "Colours", value: "Green, amber, red" },
        { label: "Forward current", value: "6 mA each" },
        { label: "Viewing angle", value: "120°" }
      ],
      materials: ["InGaN / AlGaInP LEDs", "0402 resistors"],
      relations: [
        { target: "mcu", label: "Driven by MCU GPIO" },
        { target: "buck-converter", label: "Powered from the 3.3 V rail" }
      ],
      education:
        "A resistor in series with an LED is not optional: without it the diode would draw " +
        "unlimited current and burn out.",
      failureMode:
        "An open resistor leaves a dead indicator, hiding faults and slowing diagnosis.",
      facts: [],
      keywords: ["led", "indicator", "status", "diagnostic"]
    },
    "rf-antenna": {
      name: "RF Antenna & Matching",
      short: "2.4 GHz PCB antenna with matching network",
      category: "Radio",
      function:
        "Radiates and receives the wireless link between the board and its host.",
      principle:
        "A printed inverted-F antenna is tuned by its length and by the matching components " +
        "next to it. A 50 Ω feed and a π-network trim the impedance so power is radiated " +
        "rather than reflected.",
      role:
        "Wireless range and reliability come down to this small copper shape and the ground " +
        "plane beneath it.",
      specs: [
        { label: "Band", value: "2.400–2.4835 GHz" },
        { label: "Gain", value: "≈ 2 dBi" },
        { label: "Return loss", value: "< − 10 dB" },
        { label: "Feed", value: "50 Ω, π-match" }
      ],
      materials: ["Copper trace on FR-4", "0402 matching parts"],
      relations: [
        { target: "mcu", label: "Driven by the MCU radio peripheral" },
        { target: "pcb-substrate", label: "Requires a solid ground plane beneath" }
      ],
      education:
        "An antenna is a tuned structure, not a wire. Metal, hands and enclosures near it " +
        "all shift its tuning.",
      failureMode:
        "Detuning from a nearby metal part raises return loss and silently cuts range.",
      facts: [],
      keywords: ["antenna", "rf", "wireless", "impedance", "matching"]
    }
  },

  /* ===================================================================== */
  cpuPackage: {
    ihs: {
      name: "Integrated Heat Spreader (IHS)",
      short: "Nickel-plated copper lid",
      category: "Thermal",
      function:
        "Spreads the die's concentrated heat over a larger area so a cooler can remove it " +
        "efficiently, and mechanically protects the die.",
      principle:
        "Copper conducts heat laterally; a nickel plating prevents oxidation and improves " +
        "solder wetting. The lid is bonded to the substrate with an adhesive bead, forming a " +
        "sealed cavity around the die.",
      role:
        "The die is a few hundred square millimetres of intense heat flux. Without spreading, " +
        "no cooler's base could absorb it.",
      specs: [
        { label: "Material", value: "Copper, nickel plated" },
        { label: "Thickness", value: "≈ 3 mm" },
        { label: "Thermal conductivity", value: "≈ 390 W/m·K" },
        { label: "Contact area", value: "≈ 1,700 mm²" }
      ],
      materials: ["OFC copper", "Electroless nickel"],
      relations: [
        { target: "die", label: "Covers the die on a thermal interface" },
        { target: "substrate", label: "Bonded to the organic substrate" },
        { target: "tim", label: "Separated from the die by the TIM" }
      ],
      education:
        "The lid is a heat highway interchange: narrow lanes arrive from the die, wide " +
        "lanes leave to the cooler.",
      failureMode:
        "A cracked adhesive seal lets flux or moisture into the cavity and corrodes the die " +
        "interconnect.",
      facts: [],
      keywords: ["ihs", "heat spreader", "lid", "thermal", "copper"]
    },
    die: {
      name: "Silicon Die",
      short: "The processor itself",
      category: "Compute",
      function:
        "Performs all computation: instruction execution, caching and memory control.",
      principle:
        "Billions of CMOS transistors switch at gigahertz rates. Cores, caches and " +
        "input/output blocks are laid out as separate regions on one piece of silicon. " +
        "Transistors switch fastest when small, cool and at high voltage — three constraints " +
        "that fight each other.",
      role:
        "The die is the product. Everything else in the package exists to feed it power, " +
        "take its heat away, and connect it to a motherboard.",
      specs: [
        { label: "Process", value: "≈ 7 nm class finFET" },
        { label: "Cores / threads", value: "8 / 16" },
        { label: "Die area", value: "≈ 210 mm²" },
        { label: "Transistors", value: "≈ 10 billion" },
        { label: "Power density", value: "> 100 W/cm² locally" }
      ],
      materials: ["Monocrystalline silicon", "Copper interconnect", "Low-k dielectric"],
      relations: [
        { target: "ihs", label: "Heat flows into the lid" },
        { target: "tim", label: "Thermal path to the lid" },
        { target: "substrate", label: "Flip-chip bonded to the substrate" },
        { target: "decoupling-caps", label: "Needs local charge for fast current steps" }
      ],
      education:
        "A modern core can change its power draw by tens of amps in nanoseconds. That is " +
        "why capacitors sit millimetres away, not centimetres.",
      failureMode:
        "Electromigration slowly thins interconnect; overheating accelerates it until the " +
        "chip becomes unstable.",
      facts: ["Local power density can exceed that of a rocket nozzle wall."],
      keywords: ["die", "silicon", "cores", "processor", "transistors"]
    },
    tim: {
      name: "Thermal Interface Material",
      short: "Solder or paste between die and lid",
      category: "Thermal",
      function:
        "Fills microscopic air gaps between die and lid so heat can cross without an " +
        "insulating air layer.",
      principle:
        "Even flat surfaces touch at only a few percent of their area. A thin layer of high- " +
        "conductivity material displaces air. Performance depends on thickness as much as " +
        "conductivity: thermal resistance is thickness divided by conductivity.",
      role:
        "It is the weakest link in the thermal chain and the reason delidding exists.",
      specs: [
        { label: "Type", value: "Indium solder (or polymer paste)" },
        { label: "Conductivity", value: "≈ 40–80 W/m·K (solder)" },
        { label: "Bond line", value: "20–100 µm" },
        { label: "Contribution", value: "≈ 0.05 K·cm²/W" }
      ],
      materials: ["Indium alloy", "Silicone polymer", "Metal-oxide fillers"],
      relations: [
        { target: "die", label: "Bonds to the die backside" },
        { target: "ihs", label: "Bonds to the lid underside" }
      ],
      education:
        "Two flat metal blocks pressed together still have air between them. Air is a " +
        "terrible heat conductor, so we fill the gaps.",
      failureMode:
        "Pump-out or drying of paste increases thermal resistance over years, raising " +
        "temperatures at the same load.",
      facts: [],
      keywords: ["tim", "thermal paste", "solder", "interface", "resistance"]
    },
    substrate: {
      name: "Organic Substrate",
      short: "Multi-layer package circuit board",
      category: "Interconnect",
      function:
        "Fans out the die's fine-pitch connections to the coarser motherboard land pattern " +
        "and carries power and ground.",
      principle:
        "A high-density multi-layer laminate with microvias. Hundreds of differential pairs " +
        "run to memory channels, and dozens of power planes deliver current with low " +
        "inductance.",
      role:
        "It is the electrical and mechanical bridge between nanometre silicon and millimetre " +
        "motherboard.",
      specs: [
        { label: "Layers", value: "10–12" },
        { label: "Size", value: "≈ 45 × 37.5 mm" },
        { label: "Trace pitch", value: "≈ 30 µm" },
        { label: "Warpage limit", value: "< 100 µm" }
      ],
      materials: ["BT resin laminate", "Copper", "Solder mask"],
      relations: [
        { target: "die", label: "Die is flip-chip bonded on top" },
        { target: "lga-pads", label: "Lands on the underside" },
        { target: "decoupling-caps", label: "Surface-mounted on the underside" }
      ],
      education:
        "The substrate is where cost and difficulty concentrate: it must survive soldering " +
        "at 250 °C and then stay flat for the life of the product.",
      failureMode:
        "Warpage or thermal cycling cracks the die-to-substrate joints, causing intermittent " +
        "memory channel errors.",
      facts: [],
      keywords: ["substrate", "package", "laminate", "interconnect", "fanout"]
    },
    "lga-pads": {
      name: "Land Grid Array Contacts",
      short: "Bottom-side contact pads",
      category: "Interconnect",
      function:
        "Connects the package to the motherboard socket with hundreds of low-inductance " +
        "power and signal contacts.",
      principle:
        "Gold-plated copper lands mate with spring pins in the socket. Contact force must be " +
        "high enough to break oxide films but low enough not to damage the pads. Power and " +
        "ground lands are grouped to keep current loops short.",
      role:
        "Every signal in and out of the processor crosses these contacts, together with " +
        "more than a hundred amps of supply current.",
      specs: [
        { label: "Land count", value: "≈ 1,700" },
        { label: "Pitch", value: "0.90 mm" },
        { label: "Plating", value: "Gold over nickel" },
        { label: "Contact resistance", value: "< 20 mΩ" }
      ],
      materials: ["Copper lands", "Nickel-gold plating", "Phosphor-bronze socket pins"],
      relations: [
        { target: "substrate", label: "Formed on the substrate underside" },
        { target: "retention-frame", label: "Held in contact by the socket load plate" }
      ],
      education:
        "Contact is mechanical: without enough clamping force the resistance rises and the " +
        "chip sees voltage droop exactly when it needs current.",
      failureMode:
        "Bent or contaminated lands produce memory channel drops or a board that will not " +
        "POST.",
      facts: [],
      keywords: ["lga", "pads", "socket", "contacts", "package"]
    },
    "decoupling-caps": {
      name: "Decoupling Capacitors",
      short: "Ceramic capacitors on the package underside",
      category: "Power delivery",
      function:
        "Supplies charge locally during the nanosecond current transients of switching " +
        "cores, keeping the supply voltage stable.",
      principle:
        "Placed millimetres from the die, low-inductance capacitors respond faster than the " +
        "voltage regulator, which is centimetres away. Their job is to keep the impedance " +
        "of the power delivery network low across a wide frequency range.",
      role:
        "Voltage droop is what limits maximum clock speed; these parts are a performance " +
        "component, not a nicety.",
      specs: [
        { label: "Count", value: "≈ 60 (package + socket)" },
        { label: "Capacitance", value: "100 nF – 1 µF" },
        { label: "Dielectric", value: "X6S / X7R" },
        { label: "ESL", value: "< 150 pH" }
      ],
      materials: ["Barium titanate ceramic", "Nickel electrodes"],
      relations: [
        { target: "die", label: "Buffers the die's supply" },
        { target: "substrate", label: "Mounted on the package underside" }
      ],
      education:
        "A regulator reacts in microseconds; a transistor switches in picoseconds. The " +
        "capacitor is the only thing close enough to answer instantly.",
      failureMode:
        "A cracked capacitor from board flex leaves a high-frequency gap in the power " +
        "delivery network, causing instability under load.",
      facts: [],
      keywords: ["capacitor", "decoupling", "power delivery", "vrm", "transient"]
    },
    "retention-frame": {
      name: "Retention Frame & Load Plate",
      short: "Socket mechanism clamping the package",
      category: "Mechanical",
      function:
        "Applies a controlled, uniform clamping force that holds the package against the " +
        "socket contacts.",
      principle:
        "A stiff steel frame and a cam lever compress a load plate with a defined spring " +
        "rate. The force is distributed through a stiffener so the package does not bend " +
        "beyond its flatness limit.",
      role:
        "It turns hundreds of individual contacts into a reliable electrical interface and " +
        "keeps the package flat for the cooler.",
      specs: [
        { label: "Clamp force", value: "≈ 500 N" },
        { label: "Frame material", value: "Stainless steel" },
        { label: "Package flatness", value: "< 100 µm" },
        { label: "Cycles", value: "> 30 insertions" }
      ],
      materials: ["Stainless steel", "Glass-filled polymer", "Zinc-plated lever"],
      relations: [
        { target: "lga-pads", label: "Provides contact force" },
        { target: "substrate", label: "Constrains substrate warpage" }
      ],
      education:
        "Clamping force is a specification: too little and contacts are unreliable, too " +
        "much and the package or socket is damaged.",
      failureMode:
        "Uneven clamping from a bent frame causes one corner of contacts to go open under " +
        "thermal cycling.",
      facts: [],
      keywords: ["retention", "socket", "clamp", "mechanical", "load plate"]
    }
  },

  /* ===================================================================== */
  windTurbine: {
    tower: {
      name: "Tower",
      short: "Tapered steel tube raising the rotor into stronger wind",
      category: "Structure",
      function:
        "Supports the nacelle and rotor at hub height, where wind is stronger and less " +
        "turbulent than near the ground.",
      principle:
        "A tapered tubular steel section is stiff and cheap to fabricate. Wall thickness and " +
        "diameter are set by the bending moment from rotor thrust, which grows with the cube " +
        "of wind speed. A flanged connection joins transportable sections.",
      role:
        "It carries every load of the machine and defines the turbine's natural frequency, " +
        "which must avoid the rotor's passing frequency.",
      specs: [
        { label: "Hub height", value: "105 m" },
        { label: "Base diameter", value: "4.3 m" },
        { label: "Top diameter", value: "2.6 m" },
        { label: "Wall thickness", value: "18–38 mm" },
        { label: "Mass", value: "≈ 190 t" }
      ],
      materials: ["S355 structural steel", "Epoxy coating system"],
      relations: [
        { target: "nacelle", label: "Carries the nacelle at the top" },
        { target: "foundation", label: "Bolted to the foundation" },
        { target: "yaw-drive", label: "Provides the vertical axis for yaw" }
      ],
      education:
        "Doubling tower height increases available wind power by about 50 %, which is why " +
        "towers keep getting taller.",
      failureMode:
        "Resonance with rotor excitation causes fatigue cracking at the flange welds.",
      facts: [],
      keywords: ["tower", "structure", "steel", "height", "support"]
    },
    nacelle: {
      name: "Nacelle",
      short: "Housing for gearbox, generator and controls",
      category: "Structure",
      function:
        "Encloses and protects the drivetrain and control systems, and provides the " +
        "structural bedplate that reacts rotor loads.",
      principle:
        "A composite or steel shell on a stiff cast bedplate. The bedplate must hold the " +
        "gearbox and generator aligned within fractions of a millimetre under megawatt " +
        "torque; the shell only keeps weather out.",
      role:
        "It is a serviceable pressure vessel for machinery: everything that must be " +
        "maintained is reached from here.",
      specs: [
        { label: "Length", value: "≈ 12 m" },
        { label: "Mass", value: "≈ 65 t" },
        { label: "Bedplate", value: "Ductile cast iron" },
        { label: "Access", value: "Roof hatch + internal crane" }
      ],
      materials: ["Glass-fibre shell", "Ductile iron bedplate"],
      relations: [
        { target: "tower", label: "Yaws on top of the tower" },
        { target: "gearbox", label: "Carries the gearbox" },
        { target: "generator", label: "Carries the generator" },
        { target: "anemometer", label: "Mounts the wind sensors on the roof" }
      ],
      education:
        "The shell is not structural — it is weather protection. The loads travel through " +
        "the bedplate underneath.",
      failureMode:
        "Water ingress or failed seals corrode the bedplate and gearbox mounts.",
      facts: [],
      keywords: ["nacelle", "housing", "bedplate", "drivetrain"]
    },
    hub: {
      name: "Rotor Hub",
      short: "Central casting carrying the three blades",
      category: "Rotor",
      function:
        "Connects the blades to the main shaft and transmits their torque while allowing " +
        "pitch adjustment.",
      principle:
        "A large cast or forged hub carries pitch bearings for each blade. Rotor loads — " +
        "bending from wind thrust, gravity cycles per revolution and centrifugal force — all " +
        "converge here, making it one of the most heavily loaded castings in engineering.",
      role:
        "It is the mechanical junction between aerodynamics and the drivetrain.",
      specs: [
        { label: "Mass", value: "≈ 22 t" },
        { label: "Blade interfaces", value: "3 pitch bearings" },
        { label: "Rated rotor speed", value: "12.1 rpm" },
        { label: "Design life", value: "20 years / 10⁸ cycles" }
      ],
      materials: ["Ductile cast iron EN-GJS-400"],
      relations: [
        { target: "blade", label: "Holds the blades through pitch bearings" },
        { target: "pitch-actuator", label: "Pitch drives are inside the hub" },
        { target: "gearbox", label: "Connects to the main shaft into the gearbox" }
      ],
      education:
        "Gravity loads reverse every rotation: a blade root sees about 1.5 million load " +
        "reversals per year, which is why fatigue, not strength, governs the design.",
      failureMode:
        "Pitch bearing raceway fatigue produces blade angle drift and unbalanced loads.",
      facts: [],
      keywords: ["hub", "rotor", "blades", "casting", "pitch"]
    },
    blade: {
      name: "Rotor Blade",
      short: "Aerofoil that converts wind into torque",
      category: "Aerodynamics",
      function:
        "Extracts kinetic energy from the wind and converts it into rotor torque.",
      principle:
        "The blade is an aerofoil: air flowing over the curved upper surface moves faster " +
        "and at lower pressure, producing lift. Because the blade is twisted along its length, " +
        "each section meets the wind at a near-optimal angle despite different local speeds.",
      role:
        "Blades define how much of the wind's power the machine can capture; the theoretical " +
        "limit is about 59 % (Betz limit).",
      specs: [
        { label: "Length", value: "57 m" },
        { label: "Mass", value: "≈ 13 t each" },
        { label: "Tip speed ratio", value: "≈ 7.5" },
        { label: "Max tip speed", value: "≈ 80 m/s" },
        { label: "Material", value: "Glass-fibre / epoxy, carbon spar" }
      ],
      materials: ["Glass-fibre reinforced epoxy", "Carbon-fibre spar cap", "Balsa core"],
      relations: [
        { target: "hub", label: "Bolted to the hub root" },
        { target: "pitch-actuator", label: "Rotated by the pitch system" }
      ],
      education:
        "Blades are not pushed by the wind — they are pulled by the low pressure on their " +
        "curved side, exactly like an aircraft wing.",
      failureMode:
        "Leading-edge erosion and lightning damage reduce aerodynamic efficiency and can " +
        "lead to structural failure.",
      facts: ["A single 57 m blade sweeps an area larger than a football pitch."],
      keywords: ["blade", "aerofoil", "lift", "rotor", "wind"]
    },
    gearbox: {
      name: "Gearbox",
      short: "Multi-stage planetary-helical speed increaser",
      category: "Drivetrain",
      function:
        "Raises the rotor's low speed (≈ 12 rpm) to the generator's speed (≈ 1,200 rpm).",
      principle:
        "A planetary first stage handles the enormous input torque across several planet " +
        "gears, then helical stages raise speed further. Total ratio is about 100:1. All " +
        "torque from the rotor passes through a few cubic metres of gears.",
      role:
        "It is the most expensive and most failure-prone part of a turbine drivetrain; " +
        "gearbox failures dominate maintenance costs.",
      specs: [
        { label: "Ratio", value: "≈ 100 : 1" },
        { label: "Input torque", value: "≈ 3.2 MN·m" },
        { label: "Output speed", value: "≈ 1,200 rpm" },
        { label: "Efficiency", value: "≈ 97 %" },
        { label: "Mass", value: "≈ 26 t" }
      ],
      materials: ["Case-hardened alloy steels", "Cast iron housing"],
      relations: [
        { target: "hub", label: "Driven by the hub through the main shaft" },
        { target: "generator", label: "Drives the generator" },
        { target: "nacelle", label: "Mounted on the bedplate with elastomer pads" }
      ],
      education:
        "At 3.2 million newton-metres of input torque, a single tooth contact carries the " +
        "weight of several trucks.",
      failureMode:
        "Bearing spalling from misalignment or lubricant breakdown leads to a crane-out " +
        "replacement costing a large fraction of the turbine's value.",
      facts: [],
      keywords: ["gearbox", "planetary", "speed", "torque", "drivetrain"]
    },
    generator: {
      name: "Generator",
      short: "Doubly-fed induction or permanent-magnet machine",
      category: "Electrical",
      function:
        "Converts shaft rotation into electrical power at grid frequency and voltage.",
      principle:
        "A rotating magnetic field induces voltage in the stator windings. A doubly-fed " +
        "induction generator uses a partial-scale converter on the rotor to handle ±30 % " +
        "speed variation; a permanent-magnet machine uses a full converter and no gearbox " +
        "in direct-drive layouts.",
      role:
        "It is the boundary between mechanics and the grid: its converter must inject clean " +
        "power and stay connected through grid faults.",
      specs: [
        { label: "Rating", value: "4.2 MW" },
        { label: "Output voltage", value: "690 V" },
        { label: "Type", value: "DFIG with partial converter" },
        { label: "Efficiency", value: "≈ 97 %" },
        { label: "Speed range", value: "900–1,500 rpm" }
      ],
      materials: ["Electrical steel laminations", "Copper windings", "NdFeB magnets (PM type)"],
      relations: [
        { target: "gearbox", label: "Driven by the gearbox output" },
        { target: "nacelle", label: "Mounted on the bedplate" },
        { target: "anemometer", label: "Torque and speed commands follow wind measurements" }
      ],
      education:
        "Grid frequency is fixed at 50 or 60 Hz. The converter decouples the generator's " +
        "variable speed from the grid, which is how a turbine can spin slower in light wind " +
        "and still deliver correct power.",
      failureMode:
        "Insulation breakdown or bearing currents lead to a ground fault and a shutdown.",
      facts: [],
      keywords: ["generator", "electrical", "grid", "converter", "power"]
    },
    "yaw-drive": {
      name: "Yaw Drive",
      short: "Motorised slew ring that turns the nacelle",
      category: "Control",
      function:
        "Keeps the rotor facing into the wind as wind direction changes.",
      principle:
        "Several electric or hydraulic drives turn pinions against a large ring gear on the " +
        "tower top. A yaw brake holds position and dampens oscillation. Control aims to " +
        "minimise yaw error while avoiding constant small movements.",
      role:
        "Misalignment with the wind costs power by the cosine cubed of the error angle, so " +
        "yaw accuracy directly affects annual energy production.",
      specs: [
        { label: "Drives", value: "4 × 1.5 kW" },
        { label: "Yaw rate", value: "0.5 °/s" },
        { label: "Brake", value: "Hydraulic disc" },
        { label: "Yaw error target", value: "< 8°" }
      ],
      materials: ["Hardened ring gear", "Cast iron gearbox housings"],
      relations: [
        { target: "nacelle", label: "Rotates the nacelle" },
        { target: "tower", label: "Runs on the tower-top ring gear" },
        { target: "anemometer", label: "Follows the measured wind direction" }
      ],
      education:
        "Cabling is the hidden constraint: the nacelle cannot rotate indefinitely without " +
        "twisting the power cables, so the controller counts accumulated turns and untwists.",
      failureMode:
        "Yaw motor or brake failure leaves the rotor misaligned or free to oscillate, " +
        "increasing loads and reducing output.",
      facts: [],
      keywords: ["yaw", "slew", "orientation", "wind direction", "control"]
    },
    "pitch-actuator": {
      name: "Pitch Actuator",
      short: "Blade angle control for power and safety",
      category: "Control",
      function:
        "Rotates each blade about its span axis to control power capture and to stop the " +
        "rotor in high wind.",
      principle:
        "Electric or hydraulic drives turn a gear ring on the blade root through a bearing. " +
        "Pitching the blade to feather (90°) removes lift and lets the rotor stop safely. " +
        "Individual pitch control also reduces asymmetric loads.",
      role:
        "It is the turbine's primary control surface and safety system; it must work on " +
        "backup power after a grid loss.",
      specs: [
        { label: "Range", value: "0–90°" },
        { label: "Rate", value: "5 °/s" },
        { label: "Actuation", value: "Electric, with backup battery" },
        { label: "Redundancy", value: "One drive per blade" }
      ],
      materials: ["Hardened gear rings", "Steel actuator housing"],
      relations: [
        { target: "blade", label: "Rotates the blade root" },
        { target: "hub", label: "Mounted inside the hub" },
        { target: "anemometer", label: "Pitch set point comes from wind conditions" }
      ],
      education:
        "Feathering is why you rarely see a modern turbine spinning in a storm: the blades " +
        "turn edge-on and shed their lift.",
      failureMode:
        "Loss of pitch authority in a storm can destroy the rotor through overspeed.",
      facts: [],
      keywords: ["pitch", "actuator", "feather", "control", "overspeed"]
    },
    anemometer: {
      name: "Wind Sensors & Controller",
      short: "Anemometer, wind vane and turbine controller",
      category: "Control",
      function:
        "Measures wind speed and direction and decides operating strategy: start, optimise, " +
        "derate or stop.",
      principle:
        "Cup or ultrasonic anemometers measure speed; vanes measure direction. The " +
        "controller compares measured power to the power curve and adjusts pitch and torque " +
        "to follow it, with hysteresis so it does not oscillate between states.",
      role:
        "It is the turbine's perception: without accurate wind data it cannot capture " +
        "maximum energy or protect itself.",
      specs: [
        { label: "Speed range", value: "0–60 m/s" },
        { label: "Accuracy", value: "± 0.2 m/s" },
        { label: "Cut-in / cut-out", value: "3 / 25 m/s" },
        { label: "Control interval", value: "20 ms" }
      ],
      materials: ["Stainless steel", "Ultrasonic transducers", "IP67 enclosure"],
      relations: [
        { target: "pitch-actuator", label: "Commands pitch angle" },
        { target: "yaw-drive", label: "Commands nacelle heading" },
        { target: "generator", label: "Sets generator torque demand" }
      ],
      education:
        "A turbine spends most of its life at partial load, so small efficiency gains in " +
        "control are worth more than a bigger generator.",
      failureMode:
        "A frozen or iced sensor gives false readings; the controller must fail safe to a " +
        "stop rather than chase bad data.",
      facts: [],
      keywords: ["anemometer", "sensor", "controller", "wind speed", "control"]
    },
    foundation: {
      name: "Foundation",
      short: "Reinforced concrete base transferring loads to the ground",
      category: "Civil",
      function:
        "Transfers the tower's enormous overturning moment and vertical load into the soil.",
      principle:
        "A large gravity base or pile group uses its own weight and the soil's resistance to " +
        "resist overturning. The tower is anchored through a cast-in bolt cage or a grouted " +
        "flange.",
      role:
        "It is the interface with the ground, built to last the 20–25 year design life with " +
        "no access for maintenance.",
      specs: [
        { label: "Diameter", value: "≈ 20 m" },
        { label: "Concrete", value: "≈ 900 m³" },
        { label: "Anchor bolts", value: "≈ 96 × M42" },
        { label: "Design moment", value: "≈ 180 MN·m" }
      ],
      materials: ["Reinforced concrete C40/50", "High-strength anchor steel"],
      relations: [
        { target: "tower", label: "Anchors the tower base" }
      ],
      education:
        "The foundation is the reason wind turbines are expensive to move: it is designed " +
        "once, in place, and never inspected visually again.",
      failureMode:
        "Anchor corrosion or grout failure allows tower base movement, which propagates " +
        "fatigue cracking upward.",
      facts: [],
      keywords: ["foundation", "concrete", "anchor", "civil", "loads"]
    }
  }
};

/* ------------------------------------------------------------------------- */
/* HELPERS                                                                   */
/* ------------------------------------------------------------------------- */

/** Look up a model definition by id. */
export function getModelDefinition(id) {
  return MODEL_LIBRARY.find(model => model.id === id) || null;
}

/** Look up component knowledge by model id + part id. */
export function getComponentData(modelId, partId) {
  return COMPONENTS[modelId]?.[partId] || null;
}

/** Resolve a relation target to a display name. */
export function resolveRelationName(modelId, targetId) {
  return COMPONENTS[modelId]?.[targetId]?.name || targetId.replace(/-/g, " ");
}

/** Flat list of all components for a model, in library order. */
export function listComponentIds(modelId) {
  return Object.keys(COMPONENTS[modelId] || {});
}
