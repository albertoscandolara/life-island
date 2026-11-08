import { z } from 'zod';
import type { PropertyModelDto } from './home.js';

/*
 * The Cars area (svc-cars, mfe-cars): every car of the household with the
 * fields of its carta di circolazione, the documents that come with it
 * (insurance, road tax, revisione, expenses), the review of new or different
 * car data, the suggestion of a car you do not have yet, and warnings for
 * everything that has to be renewed. The JSON model these follow is
 * life-island-docs/cars (vehicle.schema.json and the car blueprints).
 */

/** The car document types: categories of svc-ingestion's migration 0013. */
export const CAR_DOCUMENT_TYPES = [
  'VEHICLE_REGISTRATION',
  'CAR_INSURANCE',
  'ROAD_TAX',
  'VEHICLE_INSPECTION',
  'VEHICLE_EXPENSE',
] as const;
export type CarDocumentType = (typeof CAR_DOCUMENT_TYPES)[number];

/** Their root category; a car document filed only under it has no specific type. */
export const CAR_DOCUMENT_ROOT = 'CAR_DOCUMENT';

export const CAR_DOCUMENT_TYPE_LABELS: Record<CarDocumentType, string> = {
  VEHICLE_REGISTRATION: 'Registration certificate',
  CAR_INSURANCE: 'Insurance',
  ROAD_TAX: 'Road tax (bollo)',
  VEHICLE_INSPECTION: 'Inspection (revisione)',
  VEHICLE_EXPENSE: 'Expense',
};

/**
 * Every code printed on the Italian carta di circolazione and documento unico
 * (Directive 1999/37/EC, Annex I), with its meaning and the label printed on
 * the Italian card. Codes that head a group (C.1, O, P...) hold no value.
 * Same list as life-island-docs/cars/registration-codes.json.
 */
export const REGISTRATION_CODES = [
  {
    code: 'A',
    meaning: 'Registration number (number plate)',
    printed: 'Numero di immatricolazione (targa)',
  },
  {
    code: 'B',
    meaning: 'Date of first registration of the vehicle',
    printed: 'Data della prima immatricolazione del veicolo',
  },
  {
    code: 'C.1',
    meaning: 'Holder of the registration certificate',
    printed: 'Intestatario della carta di circolazione',
  },
  {
    code: 'C.1.1',
    meaning: 'Holder: surname or company name',
    printed: 'Intestatario: cognome o ragione sociale',
  },
  {
    code: 'C.1.2',
    meaning: 'Holder: first name or initials',
    printed: 'Intestatario: nome o iniziali',
  },
  {
    code: 'C.1.3',
    meaning: 'Holder: address in the country of registration on the issue date',
    printed:
      'Intestatario: indirizzo nello Stato di immatricolazione alla data di rilascio',
  },
  {
    code: 'C.2',
    meaning: 'Owner of the vehicle',
    printed: 'Proprietario del veicolo',
  },
  {
    code: 'C.2.1',
    meaning: 'Owner: surname or company name',
    printed: 'Proprietario: cognome o ragione sociale',
  },
  {
    code: 'C.2.2',
    meaning: 'Owner: first name or initials',
    printed: 'Proprietario: nome o iniziali',
  },
  {
    code: 'C.2.3',
    meaning: 'Owner: address in the country of registration on the issue date',
    printed:
      'Proprietario: indirizzo nello Stato di immatricolazione alla data di rilascio',
  },
  {
    code: 'C.3',
    meaning:
      'Person who may use the vehicle by a legal right other than ownership (lease, usufruct)',
    printed:
      'Persona che può disporre del veicolo a titolo diverso dalla proprietà (leasing, usufrutto)',
  },
  {
    code: 'C.3.1',
    meaning: 'Right holder: surname or company name',
    printed: 'Avente titolo: cognome o ragione sociale',
  },
  {
    code: 'C.3.2',
    meaning: 'Right holder: first name or initials',
    printed: 'Avente titolo: nome o iniziali',
  },
  {
    code: 'C.3.3',
    meaning:
      'Right holder: address in the country of registration on the issue date',
    printed:
      'Avente titolo: indirizzo nello Stato di immatricolazione alla data di rilascio',
  },
  {
    code: 'C.4',
    meaning:
      'Whether the holder of the certificate is the owner of the vehicle',
    printed:
      "Indicazione se l'intestatario della carta è il proprietario del veicolo",
  },
  {
    code: 'C.5',
    meaning: 'Change of the holder (C.1) after issue',
    printed: "Variazione dei dati dell'intestatario (C.1)",
  },
  {
    code: 'C.6',
    meaning: 'Change of the owner (C.2) after issue',
    printed: 'Variazione dei dati del proprietario (C.2)',
  },
  {
    code: 'C.7',
    meaning: 'Change of the right holder (C.3) after issue',
    printed: "Variazione dei dati dell'avente titolo (C.3)",
  },
  { code: 'D.1', meaning: 'Make', printed: 'Marca' },
  {
    code: 'D.2',
    meaning: 'Type, variant and version',
    printed: 'Tipo, variante e versione',
  },
  {
    code: 'D.3',
    meaning: 'Commercial name (model)',
    printed: 'Denominazione commerciale',
  },
  {
    code: 'E',
    meaning: 'Vehicle identification number (VIN, chassis number)',
    printed: 'Numero di identificazione del veicolo (telaio)',
  },
  {
    code: 'F.1',
    meaning: 'Technically permissible maximum laden mass (kg)',
    printed: 'Massa massima a carico tecnicamente ammissibile (kg)',
  },
  {
    code: 'F.2',
    meaning:
      'Permissible maximum laden mass in service in the country of registration (kg)',
    printed:
      'Massa massima a carico ammissibile in servizio nello Stato di immatricolazione (kg)',
  },
  {
    code: 'F.3',
    meaning:
      'Permissible maximum laden mass of the whole combination in service (kg)',
    printed: "Massa massima a carico ammissibile dell'insieme in servizio (kg)",
  },
  {
    code: 'G',
    meaning: 'Mass in service, with bodywork and coupling device (kg)',
    printed:
      'Massa del veicolo in servizio carrozzato e con dispositivo di attacco (kg)',
  },
  {
    code: 'H',
    meaning: 'Period of validity, if not unlimited',
    printed: 'Durata di validità, se non illimitata',
  },
  {
    code: 'I',
    meaning: 'Date of the registration this certificate refers to',
    printed: "Data dell'immatricolazione a cui si riferisce la carta",
  },
  {
    code: 'J',
    meaning: 'Vehicle category (M1, N1, L3e...)',
    printed: 'Categoria del veicolo (M1, N1, L3e...)',
  },
  {
    code: 'J.1',
    meaning: 'Kind of vehicle and its use',
    printed: 'Destinazione e uso',
  },
  { code: 'J.2', meaning: 'Bodywork', printed: 'Carrozzeria' },
  {
    code: 'K',
    meaning: 'Type-approval number',
    printed: 'Numero di omologazione del tipo',
  },
  { code: 'L', meaning: 'Number of axles', printed: 'Numero di assi' },
  { code: 'M', meaning: 'Wheelbase (mm)', printed: 'Interasse (mm)' },
  {
    code: 'N',
    meaning:
      'Distribution of the technically permissible maximum laden mass among the axles (over 3,500 kg)',
    printed:
      'Ripartizione tra gli assi della massa massima tecnicamente ammissibile (oltre 3.500 kg)',
  },
  { code: 'N.1', meaning: 'Axle 1 (kg)', printed: 'Asse 1 (kg)' },
  { code: 'N.2', meaning: 'Axle 2 (kg)', printed: 'Asse 2 (kg)' },
  { code: 'N.3', meaning: 'Axle 3 (kg)', printed: 'Asse 3 (kg)' },
  { code: 'N.4', meaning: 'Axle 4 (kg)', printed: 'Asse 4 (kg)' },
  { code: 'N.5', meaning: 'Axle 5 (kg)', printed: 'Asse 5 (kg)' },
  {
    code: 'O',
    meaning: 'Technically permissible maximum towable mass of the trailer',
    printed: 'Massa massima rimorchiabile tecnicamente ammissibile',
  },
  {
    code: 'O.1',
    meaning: 'Braked trailer (kg)',
    printed: 'Rimorchio frenato (kg)',
  },
  {
    code: 'O.2',
    meaning: 'Unbraked trailer (kg)',
    printed: 'Rimorchio non frenato (kg)',
  },
  { code: 'P', meaning: 'Engine', printed: 'Motore' },
  {
    code: 'P.1',
    meaning: 'Engine capacity (cm³)',
    printed: 'Cilindrata (cm³)',
  },
  {
    code: 'P.2',
    meaning: 'Maximum net power (kW)',
    printed: 'Potenza massima netta (kW)',
  },
  {
    code: 'P.3',
    meaning: 'Type of fuel or power source',
    printed: 'Tipo di alimentazione',
  },
  {
    code: 'P.4',
    meaning: 'Rated speed (rpm)',
    printed: 'Regime nominale (giri/min)',
  },
  {
    code: 'P.5',
    meaning: 'Engine identification number or engine type',
    printed: 'Numero di identificazione o tipo del motore',
  },
  {
    code: 'Q',
    meaning: 'Power to mass ratio (kW/kg, motorcycles only)',
    printed: 'Rapporto potenza/massa (kW/kg, solo motocicli)',
  },
  {
    code: 'R',
    meaning: 'Colour of the vehicle',
    printed: 'Colore del veicolo',
  },
  {
    code: 'S.1',
    meaning: "Number of seats, including the driver's",
    printed: 'Numero di posti a sedere, compreso il conducente',
  },
  {
    code: 'S.2',
    meaning: 'Number of standing places, if any',
    printed: 'Numero di posti in piedi, se previsti',
  },
  {
    code: 'T',
    meaning: 'Maximum speed (km/h)',
    printed: 'Velocità massima (km/h)',
  },
  { code: 'U', meaning: 'Sound level', printed: 'Livello sonoro' },
  {
    code: 'U.1',
    meaning: 'Stationary sound level (dB(A))',
    printed: 'Livello sonoro a veicolo fermo (dB(A))',
  },
  {
    code: 'U.2',
    meaning: 'Engine speed of the stationary test (rpm)',
    printed: 'Regime del motore della prova a veicolo fermo (giri/min)',
  },
  {
    code: 'U.3',
    meaning: 'Drive-by sound level (dB(A))',
    printed: 'Livello sonoro a veicolo in marcia (dB(A))',
  },
  {
    code: 'V',
    meaning: 'Exhaust emissions',
    printed: 'Emissioni allo scarico',
  },
  { code: 'V.1', meaning: 'CO (g/km or g/kWh)', printed: 'CO (g/km o g/kWh)' },
  { code: 'V.2', meaning: 'HC (g/km or g/kWh)', printed: 'HC (g/km o g/kWh)' },
  {
    code: 'V.3',
    meaning: 'NOx (g/km or g/kWh)',
    printed: 'NOx (g/km o g/kWh)',
  },
  { code: 'V.4', meaning: 'HC + NOx (g/km)', printed: 'HC + NOx (g/km)' },
  {
    code: 'V.5',
    meaning: 'Particulates, diesel engines (g/km or g/kWh)',
    printed: 'Particolato per motori diesel (g/km o g/kWh)',
  },
  {
    code: 'V.6',
    meaning: 'Corrected absorption coefficient, diesel engines (m⁻¹)',
    printed: 'Coefficiente di assorbimento corretto per motori diesel (m⁻¹)',
  },
  { code: 'V.7', meaning: 'CO2 (g/km)', printed: 'CO2 (g/km)' },
  {
    code: 'V.8',
    meaning: 'Combined fuel consumption (l/100 km)',
    printed: 'Consumo di carburante in ciclo misto (l/100 km)',
  },
  {
    code: 'V.9',
    meaning: 'Environmental category (EC directive and Euro class)',
    printed: 'Classe ambientale (direttiva CE e classe Euro)',
  },
  {
    code: 'W',
    meaning: 'Fuel tank capacity (litres)',
    printed: 'Capacità del serbatoio del carburante (litri)',
  },
  {
    code: 'X',
    meaning:
      'Proof of passing the roadworthiness test (revisione) and date of the next one',
    printed:
      'Attestazione del superamento della revisione e data della prossima',
  },
  {
    code: 'Z',
    meaning: 'Notes and national annotations',
    printed: 'Annotazioni',
  },
] as const satisfies readonly {
  code: string;
  meaning: string;
  printed: string;
}[];
export type RegistrationCode = (typeof REGISTRATION_CODES)[number]['code'];

export const REGISTRATION_CODE_MEANINGS: Record<string, string> =
  Object.fromEntries(REGISTRATION_CODES.map((c) => [c.code, c.meaning]));

export type VehicleFieldType =
  'string' | 'date' | 'integer' | 'number' | 'enum';

export interface VehicleFieldDefinition {
  /** The vehicles.json key of the JSON model, dotted for nested ones. */
  field: string;
  /** The template field key the documents app reads it into. */
  key: string;
  /** The code printed next to it on the card, or null (national section). */
  code: RegistrationCode | null;
  label: string;
  type: VehicleFieldType;
  unit?: string;
  options?: readonly string[];
  required?: boolean;
  /** What the AI is told about it. */
  description: string;
}

export const VEHICLE_CATEGORIES = [
  'M1',
  'M1G',
  'M2',
  'M3',
  'N1',
  'N1G',
  'N2',
  'N3',
  'O1',
  'O2',
  'O3',
  'O4',
  'L1e',
  'L2e',
  'L3e',
  'L4e',
  'L5e',
  'L6e',
  'L7e',
  'T',
  'other',
] as const;
export const VEHICLE_FUELS = [
  'petrol',
  'diesel',
  'lpg',
  'cng',
  'lng',
  'electric',
  'hydrogen',
  'petrol_lpg',
  'petrol_cng',
  'hybrid_petrol',
  'hybrid_diesel',
  'plug_in_hybrid_petrol',
  'plug_in_hybrid_diesel',
  'other',
] as const;
export const VEHICLE_KINDS = [
  'car',
  'goods_vehicle',
  'special_use_vehicle',
  'motorcycle',
  'moped',
  'motor_caravan',
  'trailer',
  'quadricycle',
  'other',
] as const;
export const VEHICLE_USES = [
  'own_use',
  'third_party_use',
  'rental_without_driver',
  'rental_with_driver',
  'taxi',
  'other',
] as const;
export const HOLDER_IS_OWNER = [
  'owner',
  'not_owner',
  'not_identified',
] as const;

export const VEHICLE_OPTION_LABELS: Record<string, string> = {
  petrol: 'Petrol',
  diesel: 'Diesel',
  lpg: 'LPG',
  cng: 'CNG (methane)',
  lng: 'LNG',
  electric: 'Electric',
  hydrogen: 'Hydrogen',
  petrol_lpg: 'Petrol and LPG',
  petrol_cng: 'Petrol and CNG',
  hybrid_petrol: 'Hybrid (petrol)',
  hybrid_diesel: 'Hybrid (diesel)',
  plug_in_hybrid_petrol: 'Plug-in hybrid (petrol)',
  plug_in_hybrid_diesel: 'Plug-in hybrid (diesel)',
  other: 'Other',
  car: 'Car (passenger transport)',
  goods_vehicle: 'Goods vehicle',
  special_use_vehicle: 'Special use vehicle',
  motorcycle: 'Motorcycle',
  moped: 'Moped',
  motor_caravan: 'Motor caravan',
  trailer: 'Trailer',
  quadricycle: 'Quadricycle',
  own_use: 'Own use',
  third_party_use: 'Third-party use',
  rental_without_driver: 'Rental without driver',
  rental_with_driver: 'Rental with driver',
  taxi: 'Taxi',
  owner: 'The holder is the owner',
  not_owner: 'The holder is not the owner',
  not_identified: 'Not stated who the owner is',
};

/**
 * The fields of the carta di circolazione that Life Island reads (a template
 * holds at most 40), in the order of the card. Every one has the vehicles.json
 * name of the JSON model and the code printed next to it.
 */
export const VEHICLE_FIELD_DEFINITIONS = [
  {
    field: 'registrationNumber',
    key: 'registration_number',
    code: 'A',
    label: 'Number plate',
    type: 'string',
    required: true,
    description: 'Targa, without spaces, upper-case (AB123CD)',
  },
  {
    field: 'firstRegistrationDate',
    key: 'first_registration_date',
    code: 'B',
    label: 'First registration',
    type: 'date',
    required: true,
    description: 'Data di prima immatricolazione',
  },
  {
    field: 'registrationDate',
    key: 'registration_date',
    code: 'I',
    label: 'Registration this card refers to',
    type: 'date',
    description: "Data dell'immatricolazione a cui si riferisce la carta",
  },
  {
    field: 'registrationValidUntil',
    key: 'registration_valid_until',
    code: 'H',
    label: 'Valid until',
    type: 'date',
    description: 'Durata di validità, only on temporary registrations',
  },
  {
    field: 'parties.holder.name',
    key: 'holder_name',
    code: 'C.1.1',
    label: 'Holder',
    type: 'string',
    description:
      'Intestatario: C.1.1 surname or company name and C.1.2 first name, as printed',
  },
  {
    field: 'parties.holder.taxCode',
    key: 'holder_tax_code',
    code: 'C.1',
    label: 'Holder tax code',
    type: 'string',
    description: 'Codice fiscale or VAT number of the holder, if printed',
  },
  {
    field: 'parties.holder.address',
    key: 'holder_address',
    code: 'C.1.3',
    label: 'Holder address',
    type: 'string',
    description: "Indirizzo dell'intestatario, as printed",
  },
  {
    field: 'parties.owner.name',
    key: 'owner_name',
    code: 'C.2.1',
    label: 'Owner',
    type: 'string',
    description:
      'Proprietario (C.2.1 and C.2.2), only when printed apart from the holder',
  },
  {
    field: 'parties.holderIsOwner',
    key: 'holder_is_owner',
    code: 'C.4',
    label: 'Holder is the owner',
    type: 'enum',
    options: HOLDER_IS_OWNER,
    description: 'C.4 a) owner, b) not_owner, c) not_identified',
  },
  {
    field: 'make',
    key: 'make',
    code: 'D.1',
    label: 'Make',
    type: 'string',
    required: true,
    description: 'Marca (FIAT)',
  },
  {
    field: 'type',
    key: 'type_variant_version',
    code: 'D.2',
    label: 'Type, variant, version',
    type: 'string',
    description: 'Tipo, variante, versione as printed',
  },
  {
    field: 'commercialName',
    key: 'commercial_name',
    code: 'D.3',
    label: 'Model',
    type: 'string',
    description: 'Denominazione commerciale (PANDA)',
  },
  {
    field: 'vin',
    key: 'vin',
    code: 'E',
    label: 'VIN (chassis number)',
    type: 'string',
    required: true,
    description: 'Numero di telaio, 17 characters',
  },
  {
    field: 'masses.technicallyPermissibleMaxKg',
    key: 'technically_permissible_max_mass_kg',
    code: 'F.1',
    label: 'Max laden mass (technical)',
    type: 'integer',
    unit: 'kg',
    description: 'Massa massima a carico tecnicamente ammissibile',
  },
  {
    field: 'masses.permissibleMaxKg',
    key: 'permissible_max_mass_kg',
    code: 'F.2',
    label: 'Max laden mass in service',
    type: 'integer',
    unit: 'kg',
    description: 'Massa massima a carico ammissibile in servizio',
  },
  {
    field: 'masses.permissibleCombinationMaxKg',
    key: 'permissible_combination_max_mass_kg',
    code: 'F.3',
    label: 'Max mass with trailer',
    type: 'integer',
    unit: 'kg',
    description: "Massa massima dell'insieme",
  },
  {
    field: 'masses.inServiceKg',
    key: 'mass_in_service_kg',
    code: 'G',
    label: 'Mass in service',
    type: 'integer',
    unit: 'kg',
    description: 'Massa del veicolo in servizio',
  },
  {
    field: 'categoryCode',
    key: 'category',
    code: 'J',
    label: 'Category',
    type: 'enum',
    options: VEHICLE_CATEGORIES,
    description: 'Categoria (M1 for a car)',
  },
  {
    field: 'kindKey',
    key: 'kind',
    code: 'J.1',
    label: 'Kind of vehicle',
    type: 'enum',
    options: VEHICLE_KINDS,
    description:
      'First half of J.1: AUTOVETTURA is car, AUTOCARRO goods_vehicle',
  },
  {
    field: 'useKey',
    key: 'use',
    code: 'J.1',
    label: 'Use',
    type: 'enum',
    options: VEHICLE_USES,
    description:
      'Second half of J.1: USO PROPRIO is own_use, USO DI TERZI third_party_use',
  },
  {
    field: 'bodyworkCode',
    key: 'bodywork',
    code: 'J.2',
    label: 'Bodywork',
    type: 'string',
    description:
      'Carrozzeria code (AA saloon, AB hatchback, AC station wagon, AF multi-purpose)',
  },
  {
    field: 'typeApprovalNumber',
    key: 'type_approval_number',
    code: 'K',
    label: 'Type-approval number',
    type: 'string',
    description: 'Numero di omologazione (e3*2007/46*0064*25)',
  },
  {
    field: 'axleCount',
    key: 'axle_count',
    code: 'L',
    label: 'Axles',
    type: 'integer',
    description: 'Numero di assi',
  },
  {
    field: 'wheelbaseMm',
    key: 'wheelbase_mm',
    code: 'M',
    label: 'Wheelbase',
    type: 'integer',
    unit: 'mm',
    description: 'Interasse',
  },
  {
    field: 'masses.brakedTrailerMaxKg',
    key: 'braked_trailer_max_kg',
    code: 'O.1',
    label: 'Braked trailer',
    type: 'integer',
    unit: 'kg',
    description: 'Massa rimorchiabile frenata',
  },
  {
    field: 'masses.unbrakedTrailerMaxKg',
    key: 'unbraked_trailer_max_kg',
    code: 'O.2',
    label: 'Unbraked trailer',
    type: 'integer',
    unit: 'kg',
    description: 'Massa rimorchiabile non frenata',
  },
  {
    field: 'engine.capacityCc',
    key: 'engine_capacity_cc',
    code: 'P.1',
    label: 'Engine capacity',
    type: 'integer',
    unit: 'cm³',
    description: 'Cilindrata',
  },
  {
    field: 'engine.maxNetPowerKw',
    key: 'max_net_power_kw',
    code: 'P.2',
    label: 'Power',
    type: 'number',
    unit: 'kW',
    description: 'Potenza massima netta',
  },
  {
    field: 'engine.fuelKey',
    key: 'fuel',
    code: 'P.3',
    label: 'Fuel',
    type: 'enum',
    options: VEHICLE_FUELS,
    description:
      'Alimentazione: BENZINA petrol, GASOLIO diesel, BENZ/GPL petrol_lpg, BENZ/METANO petrol_cng, ELETTRICA electric',
  },
  {
    field: 'engine.ratedSpeedRpm',
    key: 'rated_speed_rpm',
    code: 'P.4',
    label: 'Rated speed',
    type: 'integer',
    unit: 'rpm',
    description: 'Regime nominale',
  },
  {
    field: 'engine.engineCode',
    key: 'engine_code',
    code: 'P.5',
    label: 'Engine code',
    type: 'string',
    description: 'Numero o tipo del motore',
  },
  {
    field: 'colour',
    key: 'colour',
    code: 'R',
    label: 'Colour',
    type: 'string',
    description: 'Colore, as printed',
  },
  {
    field: 'seatCount',
    key: 'seat_count',
    code: 'S.1',
    label: 'Seats',
    type: 'integer',
    description: 'Posti a sedere, driver included',
  },
  {
    field: 'maxSpeedKmh',
    key: 'max_speed_kmh',
    code: 'T',
    label: 'Top speed',
    type: 'integer',
    unit: 'km/h',
    description: 'Velocità massima',
  },
  {
    field: 'emissions.co2GKm',
    key: 'co2_g_km',
    code: 'V.7',
    label: 'CO2',
    type: 'number',
    unit: 'g/km',
    description: 'Emissioni di CO2',
  },
  {
    field: 'emissions.combinedFuelConsumptionL100km',
    key: 'combined_fuel_consumption',
    code: 'V.8',
    label: 'Combined consumption',
    type: 'number',
    unit: 'l/100 km',
    description: 'Consumo in ciclo misto',
  },
  {
    field: 'emissions.emissionClass',
    key: 'emission_class',
    code: 'V.9',
    label: 'Environmental class',
    type: 'string',
    description: 'Classe ambientale as printed (715/2007*2018/1832AP EURO 6D)',
  },
  {
    field: 'fuelTankCapacityL',
    key: 'fuel_tank_capacity_l',
    code: 'W',
    label: 'Fuel tank',
    type: 'number',
    unit: 'l',
    description: 'Capacità del serbatoio',
  },
] as const satisfies readonly VehicleFieldDefinition[];

export type VehicleField = (typeof VEHICLE_FIELD_DEFINITIONS)[number]['field'];
export const VEHICLE_FIELDS = VEHICLE_FIELD_DEFINITIONS.map(
  (d) => d.field,
) as VehicleField[];

/** Never change on a car: a difference is a misread, or another car. */
export const STABLE_VEHICLE_FIELDS: readonly VehicleField[] = [
  'registrationNumber',
  'firstRegistrationDate',
  'make',
  'type',
  'vin',
  'typeApprovalNumber',
];

/** The certificate's own facts (not about the car), with their template keys. */
export const REGISTRATION_CERTIFICATE_KEYS = {
  documentNumber: 'document_number',
  issueDate: 'issue_date',
} as const;

/** What every other car document prints about the car, with its template keys. */
export const CAR_REFERENCE_KEYS = {
  registrationNumber: 'registration_number',
  vin: 'vin',
  make: 'make',
  commercialName: 'commercial_name',
} as const;

export const EXPENSE_KINDS = [
  'fuel',
  'ev_charging',
  'scheduled_service',
  'repair',
  'tyres',
  'body_work',
  'car_wash',
  'toll',
  'parking',
  'accessories',
  'fine',
  'other',
] as const;
export type ExpenseKind = (typeof EXPENSE_KINDS)[number];

/** What a cost is, for the totals: an expense kind, or a renewable document. */
export type CostKind = ExpenseKind | 'insurance' | 'road_tax' | 'inspection';
export const COST_KIND_LABELS: Record<CostKind, string> = {
  insurance: 'Insurance',
  road_tax: 'Road tax',
  inspection: 'Revisione',
  fuel: 'Fuel',
  ev_charging: 'Charging',
  scheduled_service: 'Service',
  repair: 'Repairs',
  tyres: 'Tyres',
  body_work: 'Body work',
  car_wash: 'Car wash',
  toll: 'Tolls',
  parking: 'Parking',
  accessories: 'Accessories',
  fine: 'Fines',
  other: 'Other',
};

export const INSPECTION_OUTCOMES = ['passed', 'repeat', 'suspended'] as const;
export type InspectionOutcome = (typeof INSPECTION_OUTCOMES)[number];

/** Everything about a car that has to be renewed. */
export const RENEWABLE_KINDS = [
  'insurance',
  'road_tax',
  'inspection',
  'service',
  'registration',
] as const;
export type RenewableKind = (typeof RENEWABLE_KINDS)[number];

export const RENEWABLE_LABELS: Record<RenewableKind, string> = {
  insurance: 'Insurance',
  road_tax: 'Road tax (bollo)',
  inspection: 'Revisione',
  service: 'Service',
  registration: 'Temporary registration',
};

/**
 * How long before its date each renewable item warns: a revisione has to be
 * booked, insurance quotes compared, the bollo paid within the month after.
 */
export const RENEWAL_WARNING_DAYS: Record<RenewableKind, number> = {
  insurance: 30,
  road_tax: 30,
  inspection: 60,
  service: 30,
  registration: 30,
};

/** The RCA still covers you 15 days after it expires (art. 170-bis Codice delle Assicurazioni). */
export const INSURANCE_GRACE_DAYS = 15;
/** First revisione 4 years after first registration, then every 2 (art. 80 Codice della Strada). */
export const FIRST_INSPECTION_MONTHS = 48;
export const INSPECTION_INTERVAL_MONTHS = 24;

export const VEHICLE_STATUSES = [
  'active',
  'sold',
  'scrapped',
  'stolen',
] as const;
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];
export const VEHICLE_STATUS_LABELS: Record<VehicleStatus, string> = {
  active: 'In use',
  sold: 'Sold',
  scrapped: 'Scrapped',
  stolen: 'Stolen',
};

/** Where a version stands in its series; cancelled is set by you. */
export const CAR_DOCUMENT_STATUSES = [
  'current',
  'expired',
  'superseded',
  'cancelled',
] as const;
export type CarDocumentStatus = (typeof CAR_DOCUMENT_STATUSES)[number];
export const CAR_DOCUMENT_STATUS_LABELS: Record<CarDocumentStatus, string> = {
  current: 'Current',
  expired: 'Expired',
  superseded: 'Replaced by a newer one',
  cancelled: 'Cancelled',
};

export type VehicleValue = string | number | null;
export type VehicleValues = Record<VehicleField, VehicleValue>;

export interface CarDocumentVersionDto {
  uploadId: string;
  title: string;
  type: CarDocumentType | null;
  version: number;
  status: CarDocumentStatus;
  /** Policy, receipt or certificate number. */
  number: string | null;
  /** Insurer, Regione or inspection centre. */
  issuer: string | null;
  validFrom: string | null;
  /** The date it has to be renewed by, when it has one. */
  validUntil: string | null;
  amount: number | null;
  uploadedAt: string;
  reviewedAt: string;
}

/** One kind of renewable document of one car, newest version first. */
export interface CarDocumentSeriesDto {
  type: CarDocumentType | null;
  versions: CarDocumentVersionDto[];
}

export type RenewalLevel = 'ok' | 'expiring' | 'grace' | 'expired' | 'missing';

/** Where one renewable item of a car stands today. */
export interface RenewalDto {
  kind: RenewableKind;
  level: RenewalLevel;
  /** The date it has to be renewed by; null when nothing says (missing). */
  dueDate: string | null;
  /** Negative once past. */
  daysLeft: number | null;
  /** Insurance only: the last day of the 15 days of cover after expiry. */
  graceUntil: string | null;
  /** The document it was worked out from. */
  uploadId: string | null;
  /** How the date was found, e.g. "2 years after the last revisione". */
  basis: string;
  /** Service only: the km it is due at, when printed. */
  dueOdometerKm: number | null;
}

/** A renewal that needs you: expiring, in its grace period, expired or missing. */
export interface RenewalAlertDto extends RenewalDto {
  vehicleId: string;
  vehicleName: string;
}

export interface CarCostDto {
  uploadId: string;
  title: string;
  type: CarDocumentType | null;
  kind: CostKind;
  date: string | null;
  amount: number;
  supplier: string | null;
  odometerKm: number | null;
  litres: number | null;
}

export interface CarCostTotalDto {
  year: number;
  kind: CostKind;
  total: number;
}

export interface VehicleDto {
  id: string;
  label: string | null;
  status: VehicleStatus;
  values: VehicleValues;
  createdAt: string;
  updatedAt: string;
  series: CarDocumentSeriesDto[];
  renewals: RenewalDto[];
  alerts: RenewalAlertDto[];
  costs: CarCostDto[];
  costTotals: CarCostTotalDto[];
  /** The highest odometer reading any of its documents printed. */
  odometerKm: number | null;
  /** Your 3D model of the car (as for houses), shown instead of the drawn car. */
  model: PropertyModelDto | null;
}

export type VehicleChangeKind = 'new_value' | 'different_value';
export type VehicleChangeSuggestion = 'accept' | 'keep_current' | 'check';

export interface VehicleChangeDto {
  field: VehicleField;
  code: string | null;
  kind: VehicleChangeKind;
  current: VehicleValue;
  proposed: string | number;
  suggestion: VehicleChangeSuggestion;
}

/** How a document was matched to the cars you have. */
export type VehicleMatch = 'vin' | 'registration_number' | 'none';

/** What a pending document says, in short, for the review. */
export interface CarDocumentFactDto {
  label: string;
  value: string;
}

/** A car document waiting for you: which car it is about and what it would change. */
export interface PendingCarReviewDto {
  uploadId: string;
  title: string;
  type: CarDocumentType | null;
  uploadedAt: string;
  registrationNumber: string | null;
  vin: string | null;
  make: string | null;
  commercialName: string | null;
  /** Dates, numbers and amounts it prints. */
  facts: CarDocumentFactDto[];
  /** Every car value it prints (a registration certificate prints them all). */
  printed: {
    field: VehicleField;
    code: string | null;
    value: string | number;
  }[];
  /** The car it was matched to; null: none (a new car, when it prints a plate or a VIN). */
  vehicleId: string | null;
  match: VehicleMatch;
  /** Against the matched car (for a new car, every printed value). */
  changes: VehicleChangeDto[];
  /** Older than a registration certificate you already have: suggests keeping your data. */
  outdated: boolean;
}

export interface RejectedCarDocumentDto {
  uploadId: string;
  title: string;
  type: CarDocumentType | null;
  decidedAt: string;
}

export interface CarsOverviewDto {
  vehicles: VehicleDto[];
  reviews: PendingCarReviewDto[];
  alerts: RenewalAlertDto[];
  rejected: RejectedCarDocumentDto[];
}

/**
 * Whether the printed values say which car it is: a plate or a VIN. A
 * document without (most fuel receipts) can be filed under a car you pick,
 * but never makes a new one.
 */
export function identifiesVehicle(document: {
  registrationNumber: string | null;
  vin: string | null;
}): boolean {
  return !!(document.registrationNumber || document.vin);
}

export const approveCarReviewRequestSchema = z.object({
  /** The car it is about; null adds a new car from it. */
  vehicleId: z.uuid().nullable(),
  /** The fields whose printed value you take; the others keep the car's value. */
  accept: z
    .array(z.enum(VEHICLE_FIELDS as [VehicleField, ...VehicleField[]]))
    .default([]),
  /** For a new car: how you call it. */
  label: z.string().trim().max(60).nullable().optional(),
});
export type ApproveCarReviewRequest = z.input<
  typeof approveCarReviewRequestSchema
>;

export const markCarDocumentRequestSchema = z.object({
  /** Cancelled (a policy ended early); null puts it back to what its dates say. */
  status: z.enum(['cancelled']).nullable(),
});
export type MarkCarDocumentRequest = z.input<
  typeof markCarDocumentRequestSchema
>;

const vehicleValue = z.union([z.string().trim(), z.number(), z.null()]);

export const createVehicleRequestSchema = z.object({
  label: z.string().trim().max(60).nullable().optional(),
  registrationNumber: z.string().trim().min(2).max(12),
});
export type CreateVehicleRequest = z.input<typeof createVehicleRequestSchema>;

/** A change to a car by hand: its name, status, or any value of its card. */
export const updateVehicleRequestSchema = z.object({
  label: z.string().trim().max(60).nullable().optional(),
  status: z.enum(VEHICLE_STATUSES).optional(),
  values: z
    .partialRecord(
      z.enum(VEHICLE_FIELDS as [VehicleField, ...VehicleField[]]),
      vehicleValue,
    )
    .optional(),
});
export type UpdateVehicleRequest = z.input<typeof updateVehicleRequestSchema>;
