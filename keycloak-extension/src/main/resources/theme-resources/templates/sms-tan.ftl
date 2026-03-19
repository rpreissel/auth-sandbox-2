<#import "template.ftl" as layout>
<@layout.registrationLayout displayMessage=!messagesPerField.existsError('smsTan'); section>
  <#if section = "header">
    SMS-TAN bestaetigen
  <#elseif section = "form">
    <form id="kc-sms-tan-form" class="${properties.kcFormClass!}" action="${url.loginAction}" method="post">
      <div class="${properties.kcFormGroupClass!}">
        <div class="${properties.kcLabelWrapperClass!}">
          <label for="smsTan" class="${properties.kcLabelClass!}">SMS-TAN</label>
        </div>
        <div class="${properties.kcInputWrapperClass!}">
          <input id="smsTan" name="smsTan" type="text" class="${properties.kcInputClass!}" autocomplete="one-time-code" autofocus />
          <#if maskedTarget?? && maskedTarget?has_content>
            <div>Ziel: ${maskedTarget}</div>
          </#if>
          <#if demoTan?? && demoTan?has_content>
            <div>Demo TAN: <strong>${demoTan}</strong></div>
          </#if>
        </div>
      </div>
      <div class="${properties.kcFormGroupClass!}">
        <input class="${properties.kcButtonClass!} ${properties.kcButtonPrimaryClass!} ${properties.kcButtonBlockClass!}" type="submit" value="2se Schritt abschliessen" />
      </div>
    </form>
  </#if>
</@layout.registrationLayout>
