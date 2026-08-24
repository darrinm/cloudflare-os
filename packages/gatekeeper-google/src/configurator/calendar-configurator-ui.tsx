import { Autocomplete, Field, h, RadioCards, Section, type ConfiguratorUISpec } from "@gadgets/configurator-ui";
import type { CalendarConfiguratorRpc, CalendarConfiguratorValues } from "./calendar-configurator-types";

export default {
  initial: { availabilityMode: "thisCalendar" },

  // A request often arrives proposing calendar "primary" (Google's own alias, and what an agent
  // naturally writes). A binding cannot store that -- it resolves per account -- so open the form on
  // the account's real primary calendar instead of a value that only fails on submit.
  async initialValuesFromResourceUrl({ resourceUrl, ui }) {
    let parsed = new URL(resourceUrl);
    let calendarId = decodeURIComponent(parsed.pathname.split("/")[2] ?? "");
    let availabilityMode = parsed.searchParams.get("availability") === "allVisible" ? "allVisible" : "thisCalendar";
    if (calendarId === "primary" || calendarId === "") {
      calendarId = (await ui.primaryCalendarId()) ?? calendarId;
    }
    return { calendarId, availabilityMode };
  },

  isReady({ values }) {
    return typeof values.calendarId === "string" && values.calendarId.length > 0
        && values.calendarId !== "primary";
  },

  resourceUrl({ values }) {
    const calendarId = encodeURIComponent(values.calendarId ?? "");
    const availabilityMode = values.availabilityMode === "allVisible" ? "allVisible" : "thisCalendar";
    return `https://calendar.google.com/calendar/${calendarId}/?availability=${availabilityMode}`;
  },

  render({ values, setValues, ui }) {
    const availabilityMode = values.availabilityMode === "allVisible" ? "allVisible" : "thisCalendar";
    return <Section>
      <Field label="Calendar" description="Choose the calendar this connection can read and manage.">
        <Autocomplete
          name="calendarId"
          value={values.calendarId}
          placeholder="Search calendars..."
          loadOptions={query => ui.listCalendars(query)}
          onChange={calendarId => setValues({ calendarId })}
        />
      </Field>

      <Field
        label="Availability lookup"
        description="Free/busy checks show only busy/free blocks, never event details."
      >
        <RadioCards
          value={availabilityMode}
          options={[
            {
              value: "thisCalendar",
              title: "This calendar only",
              description: "Check availability for this calendar only.",
            },
            {
              value: "allVisible",
              title: "All calendars visible to me",
              description: "Check anyone visible to your account. Collaborators must also be able to see their availability.",
            },
          ]}
          onChange={nextMode => {
            if (nextMode !== "thisCalendar" && nextMode !== "allVisible") return;
            setValues({ availabilityMode: nextMode });
          }}
        />
      </Field>
    </Section>;
  },
} satisfies ConfiguratorUISpec<CalendarConfiguratorRpc, CalendarConfiguratorValues>;
