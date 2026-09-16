-- SOURCE-ONLY controlled production data repair. DO NOT run without a new owner gate.
-- Exact metadata snapshot: 2026-09-16, project orlesggcjamwuknxwcpk.
-- No seats, chips, payouts, registrations, sessions or migration ledger are changed.
-- Five noncanonical TEST tables remain unnumbered. Only the exact, audited
-- dormant Bàn TEST 1 is omitted by the accompanying frontend change; the
-- other four stay fail-closed because some have active legacy assignments.
-- Seven canonical tables with active legacy assignments but no V3 session
-- receive operational_status='disabled' to prevent a second active use.
-- Rollback: separately review an exact-ID reverse update before any new session
-- uses these numbers; do not casually restore the whole physical backup.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE TEMP TABLE floor_v3_number_repair (
  id uuid PRIMARY KEY,
  club_id uuid NOT NULL,
  expected_name text NOT NULL,
  expected_number integer NOT NULL CHECK (expected_number BETWEEN 1 AND 100),
  expected_status text NOT NULL,
  UNIQUE (club_id, expected_number)
) ON COMMIT DROP;

INSERT INTO floor_v3_number_repair
  (id, club_id, expected_name, expected_number, expected_status)
VALUES
  ('2e7aa84d-64bc-41c9-ab5f-f05173b9a7ef'::uuid, '11111111-1111-1111-1111-111111111111'::uuid, 'Bàn 1', 1, 'inactive'),
  ('e99a32d2-3245-4ef4-8d98-1414c9a19a9f'::uuid, '11111111-1111-1111-1111-111111111111'::uuid, 'Bàn 2', 2, 'inactive'),
  ('48dcc6bd-e674-4ab1-8870-b1eef3ded8ba'::uuid, '11111111-1111-1111-1111-111111111111'::uuid, 'Bàn 3', 3, 'inactive'),
  ('d4082d14-83e4-4b0e-b00b-89a5db46a1ea'::uuid, '11111111-1111-1111-1111-111111111111'::uuid, 'Bàn 4', 4, 'inactive'),
  ('88fdffab-48b0-4921-926b-a6efe288db2b'::uuid, '11111111-1111-1111-1111-111111111111'::uuid, 'Bàn 5', 5, 'inactive'),
  ('7630869d-862d-4e6a-a220-745257dd92c8'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 1', 1, 'inactive'),
  ('e7dfbd1f-fcbf-4dfc-affc-62e9cbefe401'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 2', 2, 'inactive'),
  ('c247b042-c37e-4476-a1cc-165b75fd8863'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 3', 3, 'inactive'),
  ('02dfcebd-1277-483e-ba77-a7afba22633c'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 4', 4, 'inactive'),
  ('1091dee1-b7a9-48f3-8efb-1b6283e60f65'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 5', 5, 'active'),
  ('d864181a-8852-4fd4-926a-4a1ea3ae185b'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 6', 6, 'inactive'),
  ('a27fb474-51d4-4865-83bd-dc6e9722f720'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 7', 7, 'inactive'),
  ('f539c337-0d80-42f3-ab1e-9287f466cda4'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 8', 8, 'inactive'),
  ('241a00cd-e212-4d1e-bcac-40cf06b75f5f'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 9', 9, 'inactive'),
  ('7d200ce7-8c30-4704-85a3-fa5c98990e67'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 10', 10, 'inactive'),
  ('6ab7831b-6519-43bd-a9d4-b0859da7be65'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 11', 11, 'inactive'),
  ('266cc678-84a1-43b4-9812-af1db30f7a5a'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 12', 12, 'inactive'),
  ('bf8b5368-d951-4595-9fa2-a8c431a918ab'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 13', 13, 'inactive'),
  ('63c32606-2559-472f-a428-57142f71b758'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 14', 14, 'inactive'),
  ('fdac65f6-9760-484a-9de4-bd6235deae00'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 15', 15, 'inactive'),
  ('d4796c71-99a6-4012-b419-2b7f59b2bf09'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 16', 16, 'inactive'),
  ('086836bb-4eb4-4fbd-8972-206677b08d97'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 17', 17, 'inactive'),
  ('a10594dc-2c5d-4bfa-88f0-52a1bb91451c'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 18', 18, 'inactive'),
  ('17bf9718-fa69-4330-9905-529f9bdee9fd'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 19', 19, 'inactive'),
  ('27d02493-382e-4102-9d05-6bb87eb1c2e7'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 20', 20, 'inactive'),
  ('bb8f2f96-2f2c-42b9-825f-0342bc6434da'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 21', 21, 'inactive'),
  ('5ad8867f-576e-409f-aeb6-bb8e3a713d90'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 22', 22, 'inactive'),
  ('21ee96ec-34c6-446f-9558-dd649a9c88de'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 23', 23, 'inactive'),
  ('c25a3e50-d9ac-4b38-abd2-d9f5cd081434'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 24', 24, 'inactive'),
  ('379c7077-3cab-4f98-87dc-acb87fe14cae'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 25', 25, 'inactive'),
  ('23ae932a-09d4-4410-b0c4-bca469e173ed'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 26', 26, 'inactive'),
  ('78785906-9179-4fed-befe-f821d6a874b2'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 27', 27, 'inactive'),
  ('b2e755fa-65b6-493c-91dd-0e7ce7e798ec'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 28', 28, 'inactive'),
  ('c7fd3e37-0e5d-4d28-a9aa-7b5c239cea18'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 29', 29, 'inactive'),
  ('e97fb00b-1b34-4646-829b-7a4e014bdef7'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 30', 30, 'inactive'),
  ('1e11972e-dba1-4157-8f19-1e11d02b2e94'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 31', 31, 'inactive'),
  ('bbd74f04-bce7-48a5-8f70-106a1d67bffd'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 32', 32, 'inactive'),
  ('28304edc-05f3-4c46-bd6c-9355865636a2'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 33', 33, 'inactive'),
  ('dde4becd-2a05-46c1-b867-db93156cd26c'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 34', 34, 'inactive'),
  ('be8cc560-4645-4ac8-9d91-c3bd4482b7f7'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 35', 35, 'inactive'),
  ('725abc2b-d484-44ef-b1c4-47472aa224e0'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 36', 36, 'inactive'),
  ('1be0e2b9-d868-4e01-bd51-02c9dd841e04'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 37', 37, 'inactive'),
  ('947ac70b-3201-4469-a53e-41b767c54fdd'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 38', 38, 'inactive'),
  ('8af90b93-9336-4927-a1d9-469b33f433e9'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 39', 39, 'inactive'),
  ('47a6d1c0-fdef-4573-99c7-004164ee8ab0'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 40', 40, 'inactive'),
  ('76ac3362-fd1a-4a63-9014-e3409f72805a'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 41', 41, 'inactive'),
  ('0e24e620-76e4-4236-907d-9c3a4916d3cc'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 42', 42, 'inactive'),
  ('1a8e388e-59d5-4414-8382-c3e1350ae49c'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 43', 43, 'inactive'),
  ('3ff4e60d-d431-456e-8aec-08043792aaf8'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 44', 44, 'inactive'),
  ('f6d57294-098c-4ab0-a114-30332d33574b'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 45', 45, 'inactive'),
  ('55ef3fad-9f2b-4d75-85c5-c0c82218e9b3'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 46', 46, 'inactive'),
  ('90fdb0d9-74d3-440e-9d6e-37f7ea87bd03'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 47', 47, 'inactive'),
  ('93605ce7-6451-4013-8dd0-aa1160b26ca0'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 48', 48, 'inactive'),
  ('5ef7a29b-e0af-4723-bff4-58e9a5138254'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 49', 49, 'inactive'),
  ('536fc760-789d-4d96-a3d3-d6dfc79045af'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 50', 50, 'inactive'),
  ('f98ab520-2a95-487d-88f0-99a8e4335ebc'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 51', 51, 'inactive'),
  ('3a9b67be-8ebb-42e9-a16b-cfc5e95b11f7'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 52', 52, 'inactive'),
  ('e34df282-f91a-4709-8e1c-4303989f2da4'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 53', 53, 'inactive'),
  ('0026cec7-cf90-4187-bae1-d304ff912e95'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 54', 54, 'inactive'),
  ('0f6fd625-1c5a-44e4-917c-5135f4ed273b'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 55', 55, 'inactive'),
  ('425dcdf8-5605-4a0b-93cd-eb0077d7f177'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 56', 56, 'inactive'),
  ('e0d39ffa-ae3a-4d52-88d5-803bee882a43'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 57', 57, 'inactive'),
  ('0f9501f5-fd0a-4c20-90a6-58d39ee836d3'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 58', 58, 'inactive'),
  ('496fa9ce-63bc-4185-a280-9d30792ae0c6'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 59', 59, 'inactive'),
  ('75b012dc-8aba-4a17-b2cc-ac9baf164617'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 60', 60, 'inactive'),
  ('d578defb-383e-4c8b-974f-00ecba6af7c8'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 61', 61, 'inactive'),
  ('ea7f1997-953e-406e-ab74-473ffd4c70b6'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 62', 62, 'inactive'),
  ('ea7f704d-b0c1-4f76-b2b0-732f3d922522'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 63', 63, 'inactive'),
  ('ce10432b-cb11-460c-ba19-1c4bf7ba4129'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 64', 64, 'inactive'),
  ('96f05a5b-e71d-48ac-b27e-b5d52fb5d009'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 65', 65, 'inactive'),
  ('ce385ba0-ac64-44e2-8c5c-58830a3231aa'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 66', 66, 'inactive'),
  ('2452af56-e5df-46c2-aa83-de7cf7b1e31a'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 67', 67, 'inactive'),
  ('9ce84633-715a-4eae-ad00-3bc9aa1f1a32'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 68', 68, 'inactive'),
  ('5b2c1572-efbe-4c6e-af0b-f6162cb619e7'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 69', 69, 'inactive'),
  ('24f4716c-f707-4644-9bef-6f318b106652'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 70', 70, 'inactive'),
  ('b9bbd988-b8ca-4805-a539-b8a9b740d282'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 71', 71, 'inactive'),
  ('de669b4f-f46a-44ce-90b9-b9a73bf3336b'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 72', 72, 'inactive'),
  ('9a6f0c67-ca7a-4a17-898f-c62ae646fb34'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 73', 73, 'inactive'),
  ('3cd14b20-cab9-42c7-9ea8-f602e210cd34'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 74', 74, 'inactive'),
  ('985dd82a-cf86-4baf-bf8a-e0569afde053'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 75', 75, 'inactive'),
  ('b282932c-f458-465d-a594-84cb1a71c9b4'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 76', 76, 'inactive'),
  ('fe71f643-47e8-4d3a-a290-61b2e512d52c'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 77', 77, 'inactive'),
  ('e8bfb1fe-cb4e-4f85-a1b2-c9475951f583'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 78', 78, 'inactive'),
  ('9e5d5b84-a904-4596-90af-5df98c7166ce'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 79', 79, 'inactive'),
  ('367a0fb6-2a82-424c-8950-3edd1b19f96e'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 80', 80, 'inactive'),
  ('2f5a398b-78a3-4a13-9219-01a72f1bd74f'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 81', 81, 'inactive'),
  ('864b62d6-9d10-49af-9fc1-4d95111c91e2'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 82', 82, 'inactive'),
  ('8630ef8c-075d-44df-90af-d66d38ad2fe0'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 83', 83, 'inactive'),
  ('4a9b1cb7-fd4c-43cb-8fd2-ddfb98298205'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 84', 84, 'inactive'),
  ('cca48bc1-bf40-4259-8d3d-95b9f15f81d8'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 85', 85, 'inactive'),
  ('d45cbd5e-af3f-47cd-a143-999324368ca5'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 86', 86, 'inactive'),
  ('551edb97-d340-4ffd-b57e-a48e8d1f13de'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 87', 87, 'inactive'),
  ('51223892-a512-4b3a-890a-04970b56c2ca'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 88', 88, 'inactive'),
  ('f16d1a9f-36a6-4aa0-9389-e273356e807b'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 89', 89, 'inactive'),
  ('e78884f9-2f2b-439b-a2ac-232074f6786f'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 90', 90, 'inactive'),
  ('60b0e4de-f486-4823-941a-35dcd575686d'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 91', 91, 'inactive'),
  ('73addf87-0f97-42b1-a585-58e5206fa580'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 92', 92, 'inactive'),
  ('e313ef9d-7cb2-4c06-8123-831f6596e48d'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 93', 93, 'inactive'),
  ('8f1fb886-c5c7-4681-b993-9e4f6b1e13a7'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 94', 94, 'inactive'),
  ('535ff060-56c3-4834-9ef1-14bb8b94e37d'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 95', 95, 'inactive'),
  ('cbf94466-dfca-4dab-8633-3192cb9081b9'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 96', 96, 'inactive'),
  ('0050f178-25a3-4108-b520-1e3315e8b7aa'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 97', 97, 'inactive'),
  ('3c6980db-1fa5-4786-b579-c789af45a206'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 98', 98, 'inactive'),
  ('5eda7681-040d-4184-aabb-97c222eb622d'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 99', 99, 'inactive'),
  ('66eee7ab-4fdf-4440-9eb0-2f3fe5046bbf'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'Bàn 100', 100, 'inactive');

CREATE TEMP TABLE floor_v3_legacy_active_hold (id uuid PRIMARY KEY) ON COMMIT DROP;
INSERT INTO floor_v3_legacy_active_hold (id) VALUES
  ('48dcc6bd-e674-4ab1-8870-b1eef3ded8ba'::uuid), -- CLB 111 Bàn 3
  ('d4082d14-83e4-4b0e-b00b-89a5db46a1ea'::uuid), -- CLB 111 Bàn 4
  ('88fdffab-48b0-4921-926b-a6efe288db2b'::uuid), -- CLB 111 Bàn 5
  ('7630869d-862d-4e6a-a220-745257dd92c8'::uuid), -- CLB 222 Bàn 1
  ('7d200ce7-8c30-4704-85a3-fa5c98990e67'::uuid), -- CLB 222 Bàn 10
  ('66eee7ab-4fdf-4440-9eb0-2f3fe5046bbf'::uuid), -- CLB 222 Bàn 100
  ('6ab7831b-6519-43bd-a9d4-b0859da7be65'::uuid); -- CLB 222 Bàn 11

DO $repair$
DECLARE
  v_updated integer;
BEGIN
  IF (SELECT count(*) FROM floor_v3_number_repair) <> 105 THEN
    RAISE EXCEPTION 'floor_v3_repair_map_incomplete';
  END IF;
  IF (SELECT count(*) FROM floor_v3_legacy_active_hold) <> 7 THEN
    RAISE EXCEPTION 'floor_v3_repair_legacy_hold_map_incomplete';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.game_tables actual
    WHERE actual.operational_status = 'available'
      AND actual.table_number IS NULL
      AND NOT EXISTS (SELECT 1 FROM floor_v3_number_repair expected WHERE expected.id = actual.id)
  ) THEN
    RAISE EXCEPTION 'floor_v3_repair_unmapped_available_unnumbered_table';
  END IF;

  IF EXISTS (
    SELECT 1 FROM floor_v3_number_repair expected
    WHERE (EXISTS (SELECT 1 FROM floor_v3_legacy_active_hold hold_row WHERE hold_row.id = expected.id))
      IS DISTINCT FROM (
        EXISTS (
          SELECT 1 FROM public.tournament_tables assignment_row
          WHERE assignment_row.status = 'active'
            AND (assignment_row.table_id = expected.id OR assignment_row.game_table_id = expected.id)
        ) AND NOT EXISTS (
          SELECT 1 FROM public.table_sessions session_row
          WHERE session_row.game_table_id = expected.id AND session_row.closed_at IS NULL
        )
      )
  ) THEN
    RAISE EXCEPTION 'floor_v3_repair_legacy_active_set_drift';
  END IF;

  IF EXISTS (
    SELECT 1 FROM floor_v3_number_repair expected
    JOIN public.dealer_assignments dealer_row
      ON dealer_row.table_id = expected.id
    WHERE dealer_row.released_at IS NULL
      AND dealer_row.status IN ('assigned', 'on_break')
      AND NOT EXISTS (
        SELECT 1 FROM public.table_sessions session_row
        WHERE session_row.game_table_id = expected.id
          AND session_row.closed_at IS NULL
      )
  ) THEN
    RAISE EXCEPTION 'floor_v3_repair_legacy_dealer_without_session';
  END IF;

  IF EXISTS (
    SELECT 1 FROM floor_v3_number_repair expected
    LEFT JOIN public.game_tables actual ON actual.id = expected.id
    WHERE actual.id IS NULL
       OR actual.club_id IS DISTINCT FROM expected.club_id
       OR actual.table_name IS DISTINCT FROM expected.expected_name
       OR actual.status IS DISTINCT FROM expected.expected_status
       OR (actual.table_number IS NOT NULL AND actual.table_number <> expected.expected_number)
       OR (actual.operational_status IS NOT NULL AND actual.operational_status <>
           CASE WHEN EXISTS (SELECT 1 FROM floor_v3_legacy_active_hold hold_row WHERE hold_row.id=expected.id)
             THEN 'disabled' ELSE 'available' END)
  ) THEN
    RAISE EXCEPTION 'floor_v3_repair_source_drift';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.table_sessions active_session
    JOIN public.game_tables physical ON physical.id = active_session.game_table_id
    WHERE active_session.closed_at IS NULL
      AND physical.table_number IS NULL
      AND NOT EXISTS (SELECT 1 FROM floor_v3_number_repair expected WHERE expected.id = physical.id)
  ) THEN
    RAISE EXCEPTION 'floor_v3_repair_unmapped_active_session';
  END IF;

  -- The one unnumbered table intentionally omitted from the current club's
  -- picker must still be dormant across both V3 and legacy identity columns.
  IF NOT EXISTS (
    SELECT 1 FROM public.game_tables gt
    WHERE gt.id = 'df74d2ca-f319-497b-8c7a-23eb39ff0cee'::uuid
      AND gt.club_id = '22222222-2222-2222-2222-222222222222'::uuid
      AND gt.table_name = 'Bàn TEST 1'
      AND gt.status = 'inactive'
      AND gt.table_number IS NULL
      AND gt.operational_status IS NULL
  ) OR EXISTS (
    SELECT 1 FROM public.tournament_tables tt
    WHERE tt.status = 'active'
      AND (tt.table_id = 'df74d2ca-f319-497b-8c7a-23eb39ff0cee'::uuid
           OR tt.game_table_id = 'df74d2ca-f319-497b-8c7a-23eb39ff0cee'::uuid)
  ) OR EXISTS (
    SELECT 1 FROM public.tournament_seats seat_row
    WHERE seat_row.is_active
      AND (seat_row.table_id = 'df74d2ca-f319-497b-8c7a-23eb39ff0cee'::uuid
           OR seat_row.table_id IN (
             SELECT tt.id FROM public.tournament_tables tt
             WHERE tt.table_id = 'df74d2ca-f319-497b-8c7a-23eb39ff0cee'::uuid
                OR tt.game_table_id = 'df74d2ca-f319-497b-8c7a-23eb39ff0cee'::uuid
           )
           OR seat_row.tournament_table_id IN (
             SELECT tt.id FROM public.tournament_tables tt
             WHERE tt.table_id = 'df74d2ca-f319-497b-8c7a-23eb39ff0cee'::uuid
                OR tt.game_table_id = 'df74d2ca-f319-497b-8c7a-23eb39ff0cee'::uuid
           )
           OR seat_row.table_session_id IN (
             SELECT session_row.id FROM public.table_sessions session_row
             WHERE session_row.game_table_id = 'df74d2ca-f319-497b-8c7a-23eb39ff0cee'::uuid
           ))
  ) OR EXISTS (
    SELECT 1 FROM public.dealer_assignments dealer_row
    WHERE dealer_row.released_at IS NULL
      AND dealer_row.status IN ('assigned', 'on_break')
      AND (dealer_row.table_id = 'df74d2ca-f319-497b-8c7a-23eb39ff0cee'::uuid
           OR dealer_row.table_id IN (
             SELECT tt.id FROM public.tournament_tables tt
             WHERE tt.table_id = 'df74d2ca-f319-497b-8c7a-23eb39ff0cee'::uuid
                OR tt.game_table_id = 'df74d2ca-f319-497b-8c7a-23eb39ff0cee'::uuid
           )
           OR dealer_row.table_session_id IN (
             SELECT session_row.id FROM public.table_sessions session_row
             WHERE session_row.game_table_id = 'df74d2ca-f319-497b-8c7a-23eb39ff0cee'::uuid
           ))
  ) THEN
    RAISE EXCEPTION 'floor_v3_repair_dormant_test_table_drift';
  END IF;

  IF EXISTS (
    SELECT 1 FROM floor_v3_number_repair expected
    JOIN public.game_tables other
      ON other.club_id = expected.club_id
     AND other.id <> expected.id
     AND other.table_number = expected.expected_number
  ) THEN
    RAISE EXCEPTION 'floor_v3_repair_number_collision';
  END IF;

  UPDATE public.game_tables actual
  SET table_number = expected.expected_number,
      operational_status = CASE
        WHEN EXISTS (SELECT 1 FROM floor_v3_legacy_active_hold hold_row WHERE hold_row.id=expected.id)
          THEN 'disabled'
        ELSE 'available'
      END
  FROM floor_v3_number_repair expected
  WHERE actual.id = expected.id
    AND actual.table_number IS NULL
    AND actual.operational_status IS NULL;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF EXISTS (
    SELECT 1 FROM floor_v3_number_repair expected
    JOIN public.game_tables actual ON actual.id = expected.id
    WHERE actual.table_number IS DISTINCT FROM expected.expected_number
       OR actual.operational_status IS DISTINCT FROM CASE
            WHEN EXISTS (SELECT 1 FROM floor_v3_legacy_active_hold hold_row WHERE hold_row.id=expected.id)
              THEN 'disabled' ELSE 'available' END
  ) THEN
    RAISE EXCEPTION 'floor_v3_repair_postcondition_failed';
  END IF;
  RAISE NOTICE 'floor_v3_physical_number_repair_updated=%', v_updated;
END
$repair$;
COMMIT;

-- Owner-gated postcheck (read-only, run separately):
-- SELECT count(*) FROM public.game_tables WHERE table_number IS NOT NULL;
-- SELECT count(*) FROM public.table_sessions s JOIN public.game_tables g
--   ON g.id=s.game_table_id WHERE s.closed_at IS NULL AND g.table_number IS NULL;
