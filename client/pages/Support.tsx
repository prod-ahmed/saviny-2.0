import { PageHeader } from "../components/ui";

const ARTICLES = [
  { title: "Record a transaction", text: "Open Transactions, choose Add, pick income or expense, the account and the category. Amounts are always entered as positive numbers; the type sets the sign." },
  { title: "How balances are calculated", text: "Each account balance is its initial balance plus income minus expenses. Totals are recalculated every time you open a page, so nothing is stored twice." },
  { title: "How budgets track spending", text: "A budget counts expenses in its categories over its period. It turns amber from 80% of the limit and red once the limit is passed." },
  { title: "Bills and scheduled payments", text: "Marking a bill as paid only updates its status in Brixy. No payment or transfer is ever made through the app." },
  { title: "Savings goals", text: "Contributions add up to the saved amount. The completion estimate uses your average monthly contributions, so it appears once you have added some." },
  { title: "Marketplace safety", text: "Meet in a public place, check the item before paying, and never share bank details in messages. Brixy does not process payments between members." },
  { title: "Community guidelines", text: "Be respectful, avoid sharing personal financial details, and report content that breaks these rules. Moderators can hide reported posts and comments." },
];

export default function Support() {
  return (
    <div className="content module-page">
      <PageHeader eyebrow="HELP CENTER" title="Support" description="Answers about using Brixy. This version has no live chat or email support." />
      <section className="card help-articles">
        {ARTICLES.map((a) => (
          <details key={a.title}>
            <summary>{a.title}</summary>
            <p>{a.text}</p>
          </details>
        ))}
      </section>
    </div>
  );
}
