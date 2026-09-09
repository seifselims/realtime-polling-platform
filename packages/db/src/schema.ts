import { defineRelations, sql } from "drizzle-orm";
import {
  pgTable, text, timestamp, boolean, index, uuid, varchar, integer,
  pgEnum, unique, uniqueIndex, primaryKey, foreignKey, check,
} from "drizzle-orm/pg-core";

// Registered presenters and moderators. Anonymous attendees are separate.
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

// A login session, not an audience event/session.
export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_userId_idx").on(table.userId)],
);

// A user's login method. Better Auth stores a password hash in `password`.
export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("account_userId_idx").on(table.userId)],
);

// Expiring verification records, used by flows such as password resets.
export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const authRelations = defineRelations(
  { user, session, account, verification },
  (r) => ({
    user: {
      sessions: r.many.session({ from: r.user.id, to: r.session.userId }),
      accounts: r.many.account({ from: r.user.id, to: r.account.userId }),
    },
    session: {
      user: r.one.user({
        from: r.session.userId,
        to: r.user.id,
        optional: false,
      }),
    },
    account: {
      user: r.one.user({
        from: r.account.userId,
        to: r.user.id,
        optional: false,
      }),
    },
  }),
);

// Application tables. Auth's singular `session` above is only for logins.
export const sessionStatus = pgEnum("audience_session_status", ["draft", "live", "ended"]);
export const activityType = pgEnum("activity_type", ["poll", "qa", "quiz", "wordcloud", "rating"]);
export const activityStatus = pgEnum("activity_status", ["draft", "active", "closed"]);
export const questionStatus = pgEnum("question_status", ["pending", "visible", "hidden", "answered"]);

// One profile per registered presenter; identity and credentials stay in auth.
export const presenters = pgTable("presenters", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").notNull().unique().references(() => user.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const sessions = pgTable("sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  presenterId: uuid("presenter_id").notNull().references(() => presenters.id),
  title: text("title").notNull(),
  joinCode: varchar("join_code", { length: 6 }).notNull().unique(),
  status: sessionStatus("status").default("draft").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
}, (table) => [
  index("sessions_presenter_idx").on(table.presenterId),
  check("sessions_title_not_empty", sql`length(trim(${table.title})) > 0`),
  check("sessions_join_code_format", sql`${table.joinCode} ~ '^[A-Z0-9]{6}$'`),
]);

// Permissions belong to a particular event, not a permanent user hierarchy.
export const sessionModerators = pgTable("session_moderators", {
  sessionId: uuid("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.sessionId, table.userId] }),
  index("session_moderators_user_idx").on(table.userId),
]);

export const activities = pgTable("activities", {
  id: uuid("id").defaultRandom().primaryKey(),
  sessionId: uuid("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
  type: activityType("type").notNull(),
  title: text("title").notNull(),
  position: integer("position").notNull(),
  status: activityStatus("status").default("draft").notNull(),
  // Quiz timing is written and evaluated by the server.
  startedAt: timestamp("started_at", { withTimezone: true }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  timeLimitSeconds: integer("time_limit_seconds"),
  maxPoints: integer("max_points"),
  ratingMin: integer("rating_min"),
  ratingMax: integer("rating_max"),
  moderationEnabled: boolean("moderation_enabled").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("activities_session_position_unique").on(table.sessionId, table.position),
  // Composite keys let child tables prove they belong to the same session.
  unique("activities_id_session_unique").on(table.id, table.sessionId),
  uniqueIndex("activities_one_active_per_session").on(table.sessionId)
    .where(sql`${table.status} = 'active'`),
  check("activities_position_nonnegative", sql`${table.position} >= 0`),
  check("activities_title_not_empty", sql`length(trim(${table.title})) > 0`),
  check("activities_quiz_settings", sql`
    (${table.type} = 'quiz' AND ${table.timeLimitSeconds} IS NOT NULL
      AND ${table.timeLimitSeconds} > 0 AND ${table.maxPoints} IS NOT NULL AND ${table.maxPoints} > 0)
    OR (${table.type} <> 'quiz' AND ${table.timeLimitSeconds} IS NULL AND ${table.maxPoints} IS NULL)
  `),
  check("activities_rating_settings", sql`
    (${table.type} = 'rating' AND ${table.ratingMin} IS NOT NULL
      AND ${table.ratingMax} IS NOT NULL AND ${table.ratingMin} < ${table.ratingMax})
    OR (${table.type} <> 'rating' AND ${table.ratingMin} IS NULL AND ${table.ratingMax} IS NULL)
  `),
  check("activities_active_quiz_started", sql`
    ${table.type} <> 'quiz' OR ${table.status} <> 'active' OR ${table.startedAt} IS NOT NULL
  `),
]);

export const options = pgTable("options", {
  id: uuid("id").defaultRandom().primaryKey(),
  activityId: uuid("activity_id").notNull().references(() => activities.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  position: integer("position").notNull(),
  // Presenter/server-only field: do not include in attendee question payloads.
  isCorrect: boolean("is_correct").default(false).notNull(),
}, (table) => [
  unique("options_activity_position_unique").on(table.activityId, table.position),
  unique("options_id_activity_unique").on(table.id, table.activityId),
  check("options_position_nonnegative", sql`${table.position} >= 0`),
  check("options_label_not_empty", sql`length(trim(${table.label})) > 0`),
]);

export const attendees = pgTable("attendees", {
  id: uuid("id").defaultRandom().primaryKey(),
  sessionId: uuid("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
  // Browser-generated identity reused on reconnect. No account or email needed.
  clientId: uuid("client_id").notNull(),
  displayName: varchar("display_name", { length: 80 }),
  joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("attendees_session_client_unique").on(table.sessionId, table.clientId),
  unique("attendees_id_session_unique").on(table.id, table.sessionId),
]);

// Durable individual answers, not just aggregate counts. Ratings update this row.
// Handlers also validate activity type, allowed rating range, and quiz deadlines.
export const responses = pgTable("responses", {
  id: uuid("id").defaultRandom().primaryKey(),
  sessionId: uuid("session_id").notNull(),
  activityId: uuid("activity_id").notNull(),
  attendeeId: uuid("attendee_id").notNull(),
  attemptId: uuid("attempt_id").notNull().unique(),
  optionId: uuid("option_id"),
  ratingValue: integer("rating_value"),
  word: varchar("word", { length: 80 }),
  // Calculated by the server; never accepted from a client's claimed elapsed time.
  score: integer("score"),
  receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
    .$onUpdate(() => new Date()),
}, (table) => [
  unique("responses_activity_attendee_unique").on(table.activityId, table.attendeeId),
  index("responses_attendee_session_idx").on(table.attendeeId, table.sessionId),
  foreignKey({ columns: [table.activityId, table.sessionId],
    foreignColumns: [activities.id, activities.sessionId] }).onDelete("cascade"),
  foreignKey({ columns: [table.attendeeId, table.sessionId],
    foreignColumns: [attendees.id, attendees.sessionId] }).onDelete("cascade"),
  foreignKey({ columns: [table.optionId, table.activityId],
    foreignColumns: [options.id, options.activityId] }),
  check("responses_one_answer", sql`num_nonnulls(${table.optionId}, ${table.ratingValue}, ${table.word}) = 1`),
  check("responses_score_valid", sql`${table.score} IS NULL OR (${table.score} >= 0 AND ${table.optionId} IS NOT NULL)`),
  check("responses_word_not_empty", sql`${table.word} IS NULL OR length(trim(${table.word})) > 0`),
]);

export const questions = pgTable("questions", {
  id: uuid("id").defaultRandom().primaryKey(),
  sessionId: uuid("session_id").notNull(),
  activityId: uuid("activity_id").notNull(),
  attendeeId: uuid("attendee_id").notNull(),
  body: varchar("body", { length: 1000 }).notNull(),
  status: questionStatus("status").default("pending").notNull(),
  // Redis holds the live count; copy the final count here when the session ends.
  upvoteCount: integer("upvote_count").default(0).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("questions_id_session_unique").on(table.id, table.sessionId),
  index("questions_session_created_idx").on(table.sessionId, table.createdAt),
  index("questions_activity_idx").on(table.activityId),
  index("questions_attendee_idx").on(table.attendeeId),
  foreignKey({ columns: [table.activityId, table.sessionId],
    foreignColumns: [activities.id, activities.sessionId] }).onDelete("cascade"),
  foreignKey({ columns: [table.attendeeId, table.sessionId],
    foreignColumns: [attendees.id, attendees.sessionId] }).onDelete("cascade"),
  check("questions_body_not_empty", sql`length(trim(${table.body})) > 0`),
  check("questions_upvotes_nonnegative", sql`${table.upvoteCount} >= 0`),
]);

export const upvotes = pgTable("upvotes", {
  questionId: uuid("question_id").notNull(),
  attendeeId: uuid("attendee_id").notNull(),
  sessionId: uuid("session_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.questionId, table.attendeeId] }),
  index("upvotes_attendee_session_idx").on(table.attendeeId, table.sessionId),
  foreignKey({ columns: [table.questionId, table.sessionId],
    foreignColumns: [questions.id, questions.sessionId] }).onDelete("cascade"),
  foreignKey({ columns: [table.attendeeId, table.sessionId],
    foreignColumns: [attendees.id, attendees.sessionId] }).onDelete("cascade"),
]);
