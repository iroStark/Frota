--
-- PostgreSQL database dump
--

\restrict LShDShAvyot2sslgfLVXM96QEDrC5rePjZ4D6LutIzEBc5DBJnPpTMEj2fWmJyH

-- Dumped from database version 15.17 (Homebrew)
-- Dumped by pg_dump version 15.17 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

DROP TRIGGER IF EXISTS app_state_set_updated_at ON public.app_state;
DROP INDEX IF EXISTS public.uploads_uploaded_at_idx;
DROP INDEX IF EXISTS public.uploads_category_idx;
DROP INDEX IF EXISTS public.app_state_payload_gin_idx;
DROP INDEX IF EXISTS public.app_state_audit_state_saved_idx;
ALTER TABLE IF EXISTS ONLY public.uploads DROP CONSTRAINT IF EXISTS uploads_pkey;
ALTER TABLE IF EXISTS ONLY public.app_state DROP CONSTRAINT IF EXISTS app_state_pkey;
ALTER TABLE IF EXISTS ONLY public.app_state_audit DROP CONSTRAINT IF EXISTS app_state_audit_pkey;
ALTER TABLE IF EXISTS public.app_state_audit ALTER COLUMN id DROP DEFAULT;
DROP TABLE IF EXISTS public.uploads;
DROP SEQUENCE IF EXISTS public.app_state_audit_id_seq;
DROP TABLE IF EXISTS public.app_state_audit;
DROP TABLE IF EXISTS public.app_state;
DROP FUNCTION IF EXISTS public.set_updated_at();
--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: app_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_state (
    id text NOT NULL,
    payload jsonb NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: app_state_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_state_audit (
    id bigint NOT NULL,
    state_id text NOT NULL,
    payload jsonb NOT NULL,
    source text DEFAULT 'api'::text NOT NULL,
    saved_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: app_state_audit_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.app_state_audit_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: app_state_audit_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.app_state_audit_id_seq OWNED BY public.app_state_audit.id;


--
-- Name: uploads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.uploads (
    id uuid NOT NULL,
    original_name text NOT NULL,
    stored_name text NOT NULL,
    mime_type text NOT NULL,
    size_bytes bigint NOT NULL,
    category text DEFAULT 'documento'::text NOT NULL,
    url text NOT NULL,
    uploaded_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: app_state_audit id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_state_audit ALTER COLUMN id SET DEFAULT nextval('public.app_state_audit_id_seq'::regclass);


--
-- Data for Name: app_state; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.app_state (id, payload, version, created_at, updated_at) FROM stdin;
main	{"notes": [], "theme": "light", "events": [], "company": {"nif": "5000848280", "name": "UHOCHA - Comércio & Prestação de Serviços, Lda.", "location": "Lubango, Huíla"}, "drivers": [{"bi": "005840543LA049", "id": "353e40d1-6b3f-4086-80d4-c83a15c0bada", "name": "ADRIANO VASCO MIGUEL", "files": {"bi": {"id": "31167bb2-9afd-4fa7-9e50-a486b1674537", "url": "/uploads/31167bb2-9afd-4fa7-9e50-a486b1674537.png", "originalName": "Adriano Vasco.PNG"}}, "address": "CASA Nº54 BAIRRO ROCHA PINTO MAIANGA", "biValid": "2027-07-04", "license": "LD-602065", "category": "D", "createdAt": "2026-05-12T08:25:14.137Z", "licenseValid": "2029-12-09"}, {"bi": "006282445KS035", "id": "ca65619b-8949-4aa9-a110-17d211bda448", "name": "ANTÓNIO DE OLIVEIRA MANUEL", "files": {"bi": {"id": "f1338037-c889-4a0f-9ea3-21cc1969378d", "url": "/uploads/f1338037-c889-4a0f-9ea3-21cc1969378d.png", "originalName": "Antonio Manuel.PNG"}}, "address": "RUA 88 CASA Nº 58 ZONA 9 BAIRRO CASSEQUEL MAIANGA", "biValid": "2030-12-02", "license": "KM-36662", "category": "D", "createdAt": "2026-05-12T08:25:14.143Z", "licenseValid": "2039-02-12"}, {"bi": "005292663LN043", "id": "0b9c6c48-c864-4f7b-a8da-d9f7a074a64b", "name": "CARLOS JORGE DOMINGOS", "files": {"bi": {"id": "aade1b4d-853a-4e2b-860e-5afb79fae206", "url": "/uploads/aade1b4d-853a-4e2b-860e-5afb79fae206.png", "originalName": "Carlos.PNG"}}, "address": "CASA S/Nº BAIRRO VILA CUANGO", "biValid": "2032-04-05", "license": "LN-18299", "category": "D", "createdAt": "2026-05-12T08:25:14.149Z", "licenseValid": "2039-05-07"}, {"bi": "005329559ME043", "id": "95ade306-3c82-45da-9f23-b5a6f69be31f", "name": "JORGE VENTURA CANDA GONGA", "files": {"bi": {"id": "627d3c2b-3a5d-4845-a904-3a3a0adf9694", "url": "/uploads/627d3c2b-3a5d-4845-a904-3a3a0adf9694.png", "originalName": "Jorge Ventura.PNG"}}, "address": "CASA S/Nº BAIRRO BENFICA TALATONA", "biValid": "2033-05-19", "license": "LD-387005", "category": "D", "createdAt": "2026-05-12T08:25:14.154Z", "licenseValid": "2037-08-06"}, {"bi": "000659602LA037", "id": "95ed6e00-1406-46d0-b295-0a9b36098c79", "name": "JOSÉ CÂNDIDO PEREIRA", "files": {"bi": {"id": "7a35accf-5655-40bd-8caa-bfa833cbb719", "url": "/uploads/7a35accf-5655-40bd-8caa-bfa833cbb719.png", "originalName": "Josó Pereira.PNG"}}, "address": "RUA 7 CASA S/Nº BAIRRO ZANGO I VIANA", "biValid": "2033-12-27", "license": "", "category": "", "createdAt": "2026-05-12T08:25:14.157Z", "licenseValid": ""}], "version": 1, "expenses": [], "payments": [], "settings": {"province": "Luanda", "trialDays": 30, "weeklyFee": 130000, "deliveryDay": 1, "deliveryHour": "12:00", "fineOffHours": 50000, "penaltyLate24": 5000, "penaltyLate72": 15000, "contractMonths": 12, "deductibleLimit": 80000, "returnDelayDaily": 30000, "maintenanceDayName": "Segunda-feira"}, "vehicles": [{"id": "06c7ac8f-dc6d-427d-91e9-199be3dfc93a", "year": "2026", "brand": "SUZUKI", "color": "CINZENTA", "files": {"booklet": {"id": "43a4374b-d606-4057-9c7f-18ff9c423fef", "url": "/uploads/43a4374b-d606-4057-9c7f-18ff9c423fef.pdf", "originalName": "LDA-06-19-AM.pdf"}}, "model": "S-PRESSO M/T", "plate": "LDA-06-19-AM", "status": "ativo", "chassis": "MA3RFL61STA583148", "createdAt": "2026-05-12T08:25:14.121Z"}, {"id": "dadd3df0-507b-4d12-a79c-a333cf1e110e", "year": "2026", "brand": "SUZUKI", "color": "CINZENTA", "files": {"booklet": {"id": "de631329-aa21-454a-b5f2-c272cbd5bec7", "url": "/uploads/de631329-aa21-454a-b5f2-c272cbd5bec7.pdf", "originalName": "LDA-10-35-AM.pdf"}}, "model": "S-PRESSO M/T", "plate": "LDA-10-35-AM", "status": "ativo", "chassis": "MA3RFL61STA590529", "createdAt": "2026-05-12T08:25:14.126Z"}, {"id": "359c7107-a9da-49a0-a100-af851ccfaa42", "year": "2026", "brand": "SUZUKI", "color": "CINZENTA", "files": {"booklet": {"id": "5e546b1f-0ccf-417e-8ecf-9f8706f1d5be", "url": "/uploads/5e546b1f-0ccf-417e-8ecf-9f8706f1d5be.pdf", "originalName": "LDA-93-38-AL.pdf"}}, "model": "S-PRESSO M/T", "plate": "LDA-93-38-AL", "status": "ativo", "chassis": "MA3RFL61STA596238", "createdAt": "2026-05-12T08:25:14.128Z"}, {"id": "e08dd1dc-4d3d-4bc2-8825-dec1ad072e64", "year": "2026", "brand": "SUZUKI", "color": "CINZENTA", "files": {"booklet": {"id": "8d2dbc99-41d8-4071-ac9a-85e8a8bd1ab3", "url": "/uploads/8d2dbc99-41d8-4071-ac9a-85e8a8bd1ab3.pdf", "originalName": "LDA-93-59-AL.pdf"}}, "model": "S-PRESSO M/T", "plate": "LDA-93-59-AL", "status": "ativo", "chassis": "MA3RFL61STA595605", "createdAt": "2026-05-12T08:25:14.131Z"}, {"id": "f13e0f54-b338-4e3e-82e6-7e65315132a2", "year": "2026", "brand": "SUZUKI", "color": "BRANCA", "files": {"booklet": {"id": "28fe6bc3-8487-4498-99ed-5b980914535d", "url": "/uploads/28fe6bc3-8487-4498-99ed-5b980914535d.pdf", "originalName": "documentos_convertidos.pdf"}}, "model": "S-PRESSO MT", "plate": "LDA-21-95-AM", "status": "ativo", "chassis": "MA3RFL61STA590389", "createdAt": "2026-05-12T09:18:08.369Z"}], "documents": [], "assignments": []}	1	2026-05-11 21:10:20.92593+01	2026-05-12 10:18:08.378276+01
\.


--
-- Data for Name: app_state_audit; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.app_state_audit (id, state_id, payload, source, saved_at) FROM stdin;
1	main	{"notes": [], "theme": "light", "events": [], "company": {"nif": "5000848280", "name": "UHOCHA - Comércio & Prestação de Serviços, Lda.", "location": "Lubango, Huíla"}, "drivers": [], "version": 1, "expenses": [], "payments": [], "settings": {"province": "Luanda", "trialDays": 30, "weeklyFee": 130000, "deliveryDay": 1, "deliveryHour": "12:00", "fineOffHours": 50000, "penaltyLate24": 5000, "penaltyLate72": 15000, "contractMonths": 12, "deductibleLimit": 80000, "returnDelayDaily": 30000, "maintenanceDayName": "Segunda-feira"}, "vehicles": [{"id": "1778530221041-d2106b98ebb79", "year": "", "brand": "Suzuki", "color": "", "model": "Express", "plate": "", "status": "ativo", "booklet": "", "chassis": "", "mileage": "", "driverId": "", "createdAt": "2026-05-11T20:10:21.041Z", "propertyTitle": "", "insurancePolicy": ""}], "documents": []}	http://192.168.1.14:3000	2026-05-11 21:10:20.933583+01
2	main	{"notes": [], "theme": "dark", "events": [], "company": {"nif": "5000848280", "name": "UHOCHA - Comércio & Prestação de Serviços, Lda.", "location": "Lubango, Huíla"}, "drivers": [], "version": 1, "expenses": [], "payments": [], "settings": {"province": "Luanda", "trialDays": 30, "weeklyFee": 130000, "deliveryDay": 1, "deliveryHour": "12:00", "fineOffHours": 50000, "penaltyLate24": 5000, "penaltyLate72": 15000, "contractMonths": 12, "deductibleLimit": 80000, "returnDelayDaily": 30000, "maintenanceDayName": "Segunda-feira"}, "vehicles": [{"id": "1778530221041-d2106b98ebb79", "year": "", "brand": "Suzuki", "color": "", "model": "Express", "plate": "", "status": "ativo", "booklet": "", "chassis": "", "mileage": "", "driverId": "", "createdAt": "2026-05-11T20:10:21.041Z", "propertyTitle": "", "insurancePolicy": ""}], "documents": []}	http://localhost:3000	2026-05-12 08:08:21.630907+01
3	main	{"notes": [], "theme": "light", "events": [], "company": {"nif": "5000848280", "name": "UHOCHA - Comércio & Prestação de Serviços, Lda.", "location": "Lubango, Huíla"}, "drivers": [], "version": 1, "expenses": [], "payments": [], "settings": {"province": "Luanda", "trialDays": 30, "weeklyFee": 130000, "deliveryDay": 1, "deliveryHour": "12:00", "fineOffHours": 50000, "penaltyLate24": 5000, "penaltyLate72": 15000, "contractMonths": 12, "deductibleLimit": 80000, "returnDelayDaily": 30000, "maintenanceDayName": "Segunda-feira"}, "vehicles": [{"id": "1778530221041-d2106b98ebb79", "year": "", "brand": "Suzuki", "color": "", "model": "Express", "plate": "", "status": "ativo", "booklet": "", "chassis": "", "mileage": "", "driverId": "", "createdAt": "2026-05-11T20:10:21.041Z", "propertyTitle": "", "insurancePolicy": ""}], "documents": []}	http://localhost:3000	2026-05-12 08:08:25.914966+01
4	main	{"notes": [], "theme": "light", "events": [], "company": {"nif": "5000848280", "name": "UHOCHA - Comércio & Prestação de Serviços, Lda.", "location": "Lubango, Huíla"}, "drivers": [{"bi": "005840543LA049", "id": "353e40d1-6b3f-4086-80d4-c83a15c0bada", "name": "ADRIANO VASCO MIGUEL", "files": {"bi": {"id": "31167bb2-9afd-4fa7-9e50-a486b1674537", "url": "/uploads/31167bb2-9afd-4fa7-9e50-a486b1674537.png", "originalName": "Adriano Vasco.PNG"}}, "address": "CASA Nº54 BAIRRO ROCHA PINTO MAIANGA", "biValid": "2027-07-04", "license": "LD-602065", "category": "D", "createdAt": "2026-05-12T08:25:14.137Z", "licenseValid": "2029-12-09"}, {"bi": "006282445KS035", "id": "ca65619b-8949-4aa9-a110-17d211bda448", "name": "ANTÓNIO DE OLIVEIRA MANUEL", "files": {"bi": {"id": "f1338037-c889-4a0f-9ea3-21cc1969378d", "url": "/uploads/f1338037-c889-4a0f-9ea3-21cc1969378d.png", "originalName": "Antonio Manuel.PNG"}}, "address": "RUA 88 CASA Nº 58 ZONA 9 BAIRRO CASSEQUEL MAIANGA", "biValid": "2030-12-02", "license": "KM-36662", "category": "D", "createdAt": "2026-05-12T08:25:14.143Z", "licenseValid": "2039-02-12"}, {"bi": "005292663LN043", "id": "0b9c6c48-c864-4f7b-a8da-d9f7a074a64b", "name": "CARLOS JORGE DOMINGOS", "files": {"bi": {"id": "aade1b4d-853a-4e2b-860e-5afb79fae206", "url": "/uploads/aade1b4d-853a-4e2b-860e-5afb79fae206.png", "originalName": "Carlos.PNG"}}, "address": "CASA S/Nº BAIRRO VILA CUANGO", "biValid": "2032-04-05", "license": "LN-18299", "category": "D", "createdAt": "2026-05-12T08:25:14.149Z", "licenseValid": "2039-05-07"}, {"bi": "005329559ME043", "id": "95ade306-3c82-45da-9f23-b5a6f69be31f", "name": "JORGE VENTURA CANDA GONGA", "files": {"bi": {"id": "627d3c2b-3a5d-4845-a904-3a3a0adf9694", "url": "/uploads/627d3c2b-3a5d-4845-a904-3a3a0adf9694.png", "originalName": "Jorge Ventura.PNG"}}, "address": "CASA S/Nº BAIRRO BENFICA TALATONA", "biValid": "2033-05-19", "license": "LD-387005", "category": "D", "createdAt": "2026-05-12T08:25:14.154Z", "licenseValid": "2037-08-06"}, {"bi": "000659602LA037", "id": "95ed6e00-1406-46d0-b295-0a9b36098c79", "name": "JOSÉ CÂNDIDO PEREIRA", "files": {"bi": {"id": "7a35accf-5655-40bd-8caa-bfa833cbb719", "url": "/uploads/7a35accf-5655-40bd-8caa-bfa833cbb719.png", "originalName": "Josó Pereira.PNG"}}, "address": "RUA 7 CASA S/Nº BAIRRO ZANGO I VIANA", "biValid": "2033-12-27", "license": "", "category": "", "createdAt": "2026-05-12T08:25:14.157Z", "licenseValid": ""}], "version": 1, "expenses": [], "payments": [], "settings": {"province": "Luanda", "trialDays": 30, "weeklyFee": 130000, "deliveryDay": 1, "deliveryHour": "12:00", "fineOffHours": 50000, "penaltyLate24": 5000, "penaltyLate72": 15000, "contractMonths": 12, "deductibleLimit": 80000, "returnDelayDaily": 30000, "maintenanceDayName": "Segunda-feira"}, "vehicles": [{"id": "06c7ac8f-dc6d-427d-91e9-199be3dfc93a", "year": "2026", "brand": "SUZUKI", "color": "CINZENTA", "files": {"booklet": {"id": "43a4374b-d606-4057-9c7f-18ff9c423fef", "url": "/uploads/43a4374b-d606-4057-9c7f-18ff9c423fef.pdf", "originalName": "LDA-06-19-AM.pdf"}}, "model": "S-PRESSO M/T", "plate": "LDA-06-19-AM", "status": "ativo", "chassis": "MA3RFL61STA583148", "createdAt": "2026-05-12T08:25:14.121Z"}, {"id": "dadd3df0-507b-4d12-a79c-a333cf1e110e", "year": "2026", "brand": "SUZUKI", "color": "CINZENTA", "files": {"booklet": {"id": "de631329-aa21-454a-b5f2-c272cbd5bec7", "url": "/uploads/de631329-aa21-454a-b5f2-c272cbd5bec7.pdf", "originalName": "LDA-10-35-AM.pdf"}}, "model": "S-PRESSO M/T", "plate": "LDA-10-35-AM", "status": "ativo", "chassis": "MA3RFL61STA590529", "createdAt": "2026-05-12T08:25:14.126Z"}, {"id": "359c7107-a9da-49a0-a100-af851ccfaa42", "year": "2026", "brand": "SUZUKI", "color": "CINZENTA", "files": {"booklet": {"id": "5e546b1f-0ccf-417e-8ecf-9f8706f1d5be", "url": "/uploads/5e546b1f-0ccf-417e-8ecf-9f8706f1d5be.pdf", "originalName": "LDA-93-38-AL.pdf"}}, "model": "S-PRESSO M/T", "plate": "LDA-93-38-AL", "status": "ativo", "chassis": "MA3RFL61STA596238", "createdAt": "2026-05-12T08:25:14.128Z"}, {"id": "e08dd1dc-4d3d-4bc2-8825-dec1ad072e64", "year": "2026", "brand": "SUZUKI", "color": "CINZENTA", "files": {"booklet": {"id": "8d2dbc99-41d8-4071-ac9a-85e8a8bd1ab3", "url": "/uploads/8d2dbc99-41d8-4071-ac9a-85e8a8bd1ab3.pdf", "originalName": "LDA-93-59-AL.pdf"}}, "model": "S-PRESSO M/T", "plate": "LDA-93-59-AL", "status": "ativo", "chassis": "MA3RFL61STA595605", "createdAt": "2026-05-12T08:25:14.131Z"}], "documents": [], "assignments": []}	http://localhost:3000	2026-05-12 09:57:54.237496+01
\.


--
-- Data for Name: uploads; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.uploads (id, original_name, stored_name, mime_type, size_bytes, category, url, uploaded_at) FROM stdin;
43a4374b-d606-4057-9c7f-18ff9c423fef	LDA-06-19-AM.pdf	43a4374b-d606-4057-9c7f-18ff9c423fef.pdf	application/pdf	243795	documento	/uploads/43a4374b-d606-4057-9c7f-18ff9c423fef.pdf	2026-05-12 09:25:14.113482+01
de631329-aa21-454a-b5f2-c272cbd5bec7	LDA-10-35-AM.pdf	de631329-aa21-454a-b5f2-c272cbd5bec7.pdf	application/pdf	265107	documento	/uploads/de631329-aa21-454a-b5f2-c272cbd5bec7.pdf	2026-05-12 09:25:14.125547+01
5e546b1f-0ccf-417e-8ecf-9f8706f1d5be	LDA-93-38-AL.pdf	5e546b1f-0ccf-417e-8ecf-9f8706f1d5be.pdf	application/pdf	262971	documento	/uploads/5e546b1f-0ccf-417e-8ecf-9f8706f1d5be.pdf	2026-05-12 09:25:14.127369+01
8d2dbc99-41d8-4071-ac9a-85e8a8bd1ab3	LDA-93-59-AL.pdf	8d2dbc99-41d8-4071-ac9a-85e8a8bd1ab3.pdf	application/pdf	260610	documento	/uploads/8d2dbc99-41d8-4071-ac9a-85e8a8bd1ab3.pdf	2026-05-12 09:25:14.129915+01
31167bb2-9afd-4fa7-9e50-a486b1674537	Adriano Vasco.PNG	31167bb2-9afd-4fa7-9e50-a486b1674537.png	image/png	2829347	documento	/uploads/31167bb2-9afd-4fa7-9e50-a486b1674537.png	2026-05-12 09:25:14.136991+01
f1338037-c889-4a0f-9ea3-21cc1969378d	Antonio Manuel.PNG	f1338037-c889-4a0f-9ea3-21cc1969378d.png	image/png	2945507	documento	/uploads/f1338037-c889-4a0f-9ea3-21cc1969378d.png	2026-05-12 09:25:14.142663+01
aade1b4d-853a-4e2b-860e-5afb79fae206	Carlos.PNG	aade1b4d-853a-4e2b-860e-5afb79fae206.png	image/png	2988283	documento	/uploads/aade1b4d-853a-4e2b-860e-5afb79fae206.png	2026-05-12 09:25:14.148824+01
627d3c2b-3a5d-4845-a904-3a3a0adf9694	Jorge Ventura.PNG	627d3c2b-3a5d-4845-a904-3a3a0adf9694.png	image/png	2177525	documento	/uploads/627d3c2b-3a5d-4845-a904-3a3a0adf9694.png	2026-05-12 09:25:14.153848+01
7a35accf-5655-40bd-8caa-bfa833cbb719	Josó Pereira.PNG	7a35accf-5655-40bd-8caa-bfa833cbb719.png	image/png	1990748	documento	/uploads/7a35accf-5655-40bd-8caa-bfa833cbb719.png	2026-05-12 09:25:14.15739+01
28fe6bc3-8487-4498-99ed-5b980914535d	documentos_convertidos.pdf	28fe6bc3-8487-4498-99ed-5b980914535d.pdf	application/pdf	1150216	documento	/uploads/28fe6bc3-8487-4498-99ed-5b980914535d.pdf	2026-05-12 10:18:08.358852+01
\.


--
-- Name: app_state_audit_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.app_state_audit_id_seq', 4, true);


--
-- Name: app_state_audit app_state_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_state_audit
    ADD CONSTRAINT app_state_audit_pkey PRIMARY KEY (id);


--
-- Name: app_state app_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_state
    ADD CONSTRAINT app_state_pkey PRIMARY KEY (id);


--
-- Name: uploads uploads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.uploads
    ADD CONSTRAINT uploads_pkey PRIMARY KEY (id);


--
-- Name: app_state_audit_state_saved_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX app_state_audit_state_saved_idx ON public.app_state_audit USING btree (state_id, saved_at DESC);


--
-- Name: app_state_payload_gin_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX app_state_payload_gin_idx ON public.app_state USING gin (payload);


--
-- Name: uploads_category_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX uploads_category_idx ON public.uploads USING btree (category);


--
-- Name: uploads_uploaded_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX uploads_uploaded_at_idx ON public.uploads USING btree (uploaded_at DESC);


--
-- Name: app_state app_state_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER app_state_set_updated_at BEFORE UPDATE ON public.app_state FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- PostgreSQL database dump complete
--

\unrestrict LShDShAvyot2sslgfLVXM96QEDrC5rePjZ4D6LutIzEBc5DBJnPpTMEj2fWmJyH

