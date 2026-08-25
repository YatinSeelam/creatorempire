/**
 * One <script type="application/ld+json"> per object. Rendered in the page
 * body, which google reads exactly as it reads the head. `<` is escaped so a
 * stray "</script>" inside an faq answer can never close the tag early.
 */
export function JsonLd({ data }: { data: object | object[] }) {
  const list = Array.isArray(data) ? data : [data];
  return (
    <>
      {list.map((obj, i) => (
        <script
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(obj).replace(/</g, "\\u003c"),
          }}
        />
      ))}
    </>
  );
}
