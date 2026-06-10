// © 2021 Amazon Web Services, Inc. or its affiliates. All Rights Reserved.
// This AWS Content is provided subject to the terms of the AWS Customer Agreement available at
// http://aws.amazon.com/agreement or other written agreement between Customer and either
// Amazon Web Services, Inc. or Amazon Web Services EMEA SARL or both.
/* eslint-disable jsx-a11y/anchor-is-valid */
import React, { useState } from "react";
import Alert from "@awsui/components-react/alert";
import "../../index.css";
import params from "../../parameters.json";
import { Auth } from "aws-amplify";
import TopNavigation from "@awsui/components-react/top-navigation";
import { useHistory } from "react-router-dom";

function Header(props) {
  const history = useHistory();
  const [visible, setVisible] = useState(false);

  async function signOut() {
    try {
      await Auth.signOut();
    } catch (error) {
      console.log("error signing out");
    }
  }

  function Notification() {
    return (
      <Alert
        dismissible
        statusIconAriaLabel="Info"
        header="Feature announcement"
        visible={visible}
        onDismiss={() => setVisible(false)}
      >
        🚀 TEAM v1.2.0 introduces support for the use of external repositories due to CodeCommit deprecation 
      </Alert>
    );
  }

  return (
    <div>
      <TopNavigation
        identity={{
          href: "/",
          logo: {
            src: "data:image/png;base64,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",
            alt: "TEAM",
          },
        }}
        utilities={[
          {
            type: "button",
            text: "IAM Identity Center",
            href: `${params.Login}`,
            external: true,
            externalIconAriaLabel: " (opens in a new tab)",
          },
          {
            type: "button",
            iconName: "notification",
            title: "Notifications",
            ariaLabel: "Notifications (unread)",
            badge: true,
            disableUtilityCollapse: false,
            onClick: () => setVisible(true),
          },
          {
            type: "button",
            text: "v1.4.2",
            href: "https://github.com/aws-samples/iam-identity-center-team/releases/tag/v1.4.2",
            external: true,
            externalIconAriaLabel: " (opens in a new tab)",
          },
          {
            type: "menu-dropdown",
            text: `${props.user}`,
            description: `${props.user}`,
            iconName: "user-profile",
            onItemClick: ({ detail }) => {
              if (detail.id === "signout") {
                signOut().then(() => history.push("/"));
              }
            },
            items: [
              { id: "signout", text: "Sign out" },
              {
                id: "support-group",
                text: "Support",
                items: [
                  {
                    id: "documentation",
                    text: "Documentation",
                    href: "https://aws-samples.github.io/iam-identity-center-team/",
                    external: true,
                    externalIconAriaLabel: " (opens in new tab)",
                  },
                  { id: "support", text: "Support" },
                  {
                    id: "feedback",
                    text: "Feedback",
                    href: "https://pulse.aws/survey/PZDTVK85",
                    external: true,
                    externalIconAriaLabel: " (opens in new tab)",
                  },
                  {
                    id: "bug",
                    text: "Report Bug",
                    href: "https://github.com/aws-samples/iam-identity-center-team/issues",
                    external: true,
                    externalIconAriaLabel: " (opens in new tab)",
                  },
                ],
              },
            ],
          },
        ]}
        onFollow={() => {
          history.push("/");
          props.setActiveHref("/");
          props.addNotification([]);
        }}
      />
      <Notification />
    </div>
  );
}

export default Header;
