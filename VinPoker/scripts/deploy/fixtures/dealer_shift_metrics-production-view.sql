CREATE OR REPLACE VIEW "public"."dealer_shift_metrics" AS
 SELECT "da"."id" AS "attendance_id",
    "da"."dealer_id",
    "d"."full_name",
    "d"."tier",
    "d"."skills",
    "da"."shift_date",
    "da"."current_state",
    "da"."priority_break_flag",
    "da"."worked_minutes_since_last_break",
    "da"."total_worked_minutes_today",
    "da"."status",
    (COALESCE(( SELECT "sum"((EXTRACT(epoch FROM (COALESCE("db"."break_end", "now"()) - "db"."break_start")) / (60)::numeric)) AS "sum"
           FROM ("public"."dealer_breaks" "db"
             LEFT JOIN "public"."dealer_assignments" "db_assign" ON (("db_assign"."id" = "db"."assignment_id")))
          WHERE (COALESCE("db"."attendance_id", "db_assign"."attendance_id") = "da"."id")), (0)::numeric))::integer AS "total_break_minutes",
    ( SELECT "max"("db"."break_end") AS "max"
           FROM ("public"."dealer_breaks" "db"
             LEFT JOIN "public"."dealer_assignments" "db_assign" ON (("db_assign"."id" = "db"."assignment_id")))
          WHERE (COALESCE("db"."attendance_id", "db_assign"."attendance_id") = "da"."id")) AS "last_break_end",
    ( SELECT "max"("db"."break_start") AS "max"
           FROM ("public"."dealer_breaks" "db"
             LEFT JOIN "public"."dealer_assignments" "db_assign" ON (("db_assign"."id" = "db"."assignment_id")))
          WHERE (COALESCE("db"."attendance_id", "db_assign"."attendance_id") = "da"."id")) AS "last_break_start",
    (EXTRACT(epoch FROM ("now"() - COALESCE(( SELECT "max"("dassign"."released_at") AS "max"
           FROM "public"."dealer_assignments" "dassign"
          WHERE (("dassign"."attendance_id" = "da"."id") AND ("dassign"."released_at" IS NOT NULL))), "da"."check_in_time", "now"()))) / (60)::numeric) AS "minutes_since_rest",
    (( SELECT "count"(*) AS "count"
           FROM "public"."dealer_assignments" "dassign"
          WHERE (("dassign"."attendance_id" = "da"."id") AND ("dassign"."released_at" IS NOT NULL))))::integer AS "total_assignments",
    ( SELECT "dassign"."table_id"
           FROM "public"."dealer_assignments" "dassign"
          WHERE (("dassign"."attendance_id" = "da"."id") AND ("dassign"."released_at" IS NOT NULL))
          ORDER BY "dassign"."released_at" DESC
         LIMIT 1) AS "last_table_id",
    "da"."pre_assigned_table_id",
    "da"."pre_assigned_at",
    "da"."created_at",
    "da"."updated_at",
    "d"."club_id",
    "d"."status" AS "dealer_status",
    "da"."total_worked_minutes_today" AS "total_worked_minutes"
   FROM ("public"."dealer_attendance" "da"
     JOIN "public"."dealers" "d" ON (("d"."id" = "da"."dealer_id")))
  WHERE ("da"."status" = 'checked_in'::"text");
